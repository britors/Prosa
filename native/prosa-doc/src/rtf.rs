//! Leitura e escrita de `.rtf` (Rich Text Format).
//!
//! Mesmo escopo de `docx.rs`/`odt.rs`: parágrafos com as marks já suportadas
//! (bold/italic/underline/strike). Diferente dos outros dois, RTF não é XML
//! — é uma linguagem de "control words" (`\b`, `\par`, `\uNNNN`...) delimitada
//! por chaves, e por isso precisa de um tokenizer próprio em vez de um
//! parser de XML genérico.
//!
//! Conceitos do formato relevantes aqui:
//! - Chaves `{`/`}` abrem/fecham um escopo de formatação (empilhado).
//! - Alguns grupos são "destinations" que não são texto visível (tabela de
//!   fontes, de cores, folha de estilos, metadados...) — long precedidos por
//!   `\*` (destination ignorável por definição) ou por um nome conhecido
//!   (`\fonttbl`, `\colortbl`, ...). Esses grupos são pulados inteiros.
//! - Caracteres fora do ASCII: `\'hh` é um byte da code page ativa (aqui
//!   aproximado como Latin-1, que coincide com Windows-1252 na faixa de
//!   acentos do português); `\uNNNN` é um code point Unicode, seguido por
//!   `\ucN` (padrão 1) caracteres de "fallback" que devem ser descartados.

use crate::{Mark, TipTapNode};

/// Erros de leitura de um arquivo `.rtf`. A escrita não retorna erro: é só
/// construção de string, sem I/O que possa falhar.
#[derive(Debug, thiserror::Error)]
pub enum RtfError {
    #[error("RTF malformado: chaves desbalanceadas")]
    UnbalancedBraces,
}

fn text_node(text: &str, marks: &[String]) -> TipTapNode {
    let marks = if marks.is_empty() {
        None
    } else {
        let mut sorted = marks.to_vec();
        sorted.sort();
        Some(sorted.into_iter().map(|kind| Mark { kind, attrs: None }).collect())
    };
    TipTapNode { kind: "text".to_string(), text: Some(text.to_string()), marks, ..Default::default() }
}

// ---------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------

fn escape_rtf_text(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '{' => out.push_str("\\{"),
            '}' => out.push_str("\\}"),
            '\t' => out.push_str("\\tab "),
            c if c.is_ascii() && !c.is_ascii_control() => out.push(c),
            c => {
                let code = c as u32;
                // \u espera um i16 (uma unidade UTF-16). BMP (até 0xFFFF) já
                // cobre acentuação e a imensa maioria do texto em português;
                // caracteres fora do BMP (ex: emoji) precisariam de um par
                // substituto UTF-16 (dois \u), não implementado aqui.
                if code <= 0x7FFF {
                    out.push_str(&format!("\\u{code}?"));
                } else if code <= 0xFFFF {
                    out.push_str(&format!("\\u{}?", code as i32 - 0x10000));
                } else {
                    out.push('?');
                }
            }
        }
    }
    out
}

fn run_rtf(node: &TipTapNode, out: &mut String) {
    let Some(text) = &node.text else { return };
    let marks = node.marks.as_deref().unwrap_or(&[]);
    let mut prefix = String::new();
    for mark in marks {
        match mark.kind.as_str() {
            "bold" => prefix.push_str("\\b "),
            "italic" => prefix.push_str("\\i "),
            "underline" => prefix.push_str("\\ul "),
            "strike" => prefix.push_str("\\strike "),
            _ => {}
        }
    }
    if prefix.is_empty() {
        out.push_str(&escape_rtf_text(text));
    } else {
        out.push('{');
        out.push_str(&prefix);
        out.push_str(&escape_rtf_text(text));
        out.push('}');
    }
}

fn paragraph_rtf(node: &TipTapNode, out: &mut String) {
    if let Some(children) = &node.content {
        for child in children {
            run_rtf(child, out);
        }
    }
    out.push_str("\\par\n");
}

/// Serializa o `doc` TipTap como `.rtf`.
pub fn write_rtf(doc: &TipTapNode) -> Vec<u8> {
    let mut body = String::new();
    if let Some(blocks) = &doc.content {
        for block in blocks {
            paragraph_rtf(block, &mut body);
        }
    }
    let rtf = format!("{{\\rtf1\\ansi\\ansicpg1252\\deff0\n{{\\fonttbl{{\\f0 Calibri;}}}}\n\\pard\\sa200\n{body}}}");
    rtf.into_bytes()
}

// ---------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------

const SKIP_DESTINATIONS: &[&str] = &[
    "fonttbl",
    "colortbl",
    "stylesheet",
    "info",
    "generator",
    "pict",
    "object",
    "footnote",
    "header",
    "headerl",
    "headerr",
    "footer",
    "footerl",
    "footerr",
    "themedata",
    "colorschememapping",
    "latentstyles",
    "listtable",
    "listoverridetable",
    "revtbl",
    "xmlnstbl",
    "datastore",
    "shppict",
    "nonshppict",
];

#[derive(Clone, Copy, Default)]
struct FormatState {
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
}

impl FormatState {
    fn marks(&self) -> Vec<String> {
        let mut v = Vec::new();
        if self.bold {
            v.push("bold".to_string());
        }
        if self.italic {
            v.push("italic".to_string());
        }
        if self.underline {
            v.push("underline".to_string());
        }
        if self.strike {
            v.push("strike".to_string());
        }
        v
    }
}

struct Scanner<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Scanner<'a> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn next(&mut self) -> Option<u8> {
        let b = self.peek();
        if b.is_some() {
            self.pos += 1;
        }
        b
    }
}

/// Um "control word" (letras + parâmetro numérico opcional), já sem a barra
/// invertida inicial (consumida por quem chama). O único espaço delimitador
/// depois do parâmetro, se houver, é consumido e descartado.
fn read_control_word(s: &mut Scanner) -> (String, Option<i32>) {
    let mut word = String::new();
    while let Some(b) = s.peek() {
        if b.is_ascii_alphabetic() {
            word.push(b as char);
            s.next();
        } else {
            break;
        }
    }
    let mut param_str = String::new();
    if s.peek() == Some(b'-') {
        param_str.push('-');
        s.next();
    }
    while let Some(b) = s.peek() {
        if b.is_ascii_digit() {
            param_str.push(b as char);
            s.next();
        } else {
            break;
        }
    }
    let param = param_str.parse().ok();
    if s.peek() == Some(b' ') {
        s.next();
    }
    (word, param)
}

enum Token {
    Literal(char),
    ControlWord(String, Option<i32>),
    Ignored,
}

/// Lê o token logo após uma barra invertida já consumida.
fn read_backslash_token(s: &mut Scanner) -> Token {
    match s.peek() {
        Some(b'\\') => {
            s.next();
            Token::Literal('\\')
        }
        Some(b'{') => {
            s.next();
            Token::Literal('{')
        }
        Some(b'}') => {
            s.next();
            Token::Literal('}')
        }
        Some(b'\r') | Some(b'\n') => {
            s.next();
            Token::Ignored
        }
        Some(b'\'') => {
            s.next();
            let h1 = s.next().unwrap_or(b'0') as char;
            let h2 = s.next().unwrap_or(b'0') as char;
            let byte_val = u8::from_str_radix(&format!("{h1}{h2}"), 16).unwrap_or(b'?');
            // Aproximação: Windows-1252/Latin-1 coincidem na faixa 0xA0-0xFF.
            Token::Literal(byte_val as char)
        }
        _ => {
            let (word, param) = read_control_word(s);
            Token::ControlWord(word, param)
        }
    }
}

/// Descarta um único "caractere" de fallback depois de `\u` — se for ele
/// próprio um token de escape (`\'hh`, `\\`...), consome o token inteiro em
/// vez de só o primeiro byte, pra não perder sincronia com chaves depois.
fn skip_one_fallback_unit(s: &mut Scanner) {
    match s.peek() {
        Some(b'\\') => {
            s.next();
            read_backslash_token(s);
        }
        Some(b'{') | Some(b'}') | None => {}
        Some(_) => {
            s.next();
        }
    }
}

/// Espia, sem consumir, se a chave que acabou de abrir inicia uma destination
/// que deve ser pulada inteira (prefixo `\*` ou um dos nomes conhecidos).
fn peek_starts_skip_destination(s: &Scanner) -> bool {
    let mut probe = Scanner { bytes: s.bytes, pos: s.pos };
    if probe.peek() != Some(b'\\') {
        return false;
    }
    probe.next();
    if probe.peek() == Some(b'*') {
        return true;
    }
    let (word, _) = read_control_word(&mut probe);
    SKIP_DESTINATIONS.contains(&word.as_str())
}

/// Lê um arquivo `.rtf` e retorna o `doc` TipTap equivalente.
pub fn read_rtf(bytes: &[u8]) -> Result<TipTapNode, RtfError> {
    let mut s = Scanner { bytes, pos: 0 };

    let mut paragraphs: Vec<TipTapNode> = Vec::new();
    let mut para_runs: Vec<TipTapNode> = Vec::new();
    let mut current_text = String::new();
    let mut current_marks: Vec<String> = Vec::new();

    let mut state_stack: Vec<FormatState> = vec![FormatState::default()];
    let mut unicode_skip_stack: Vec<i32> = vec![1];
    let mut skip_depth: Option<i32> = None;
    let mut depth: i32 = 0;

    macro_rules! flush_run {
        () => {
            if !current_text.is_empty() {
                para_runs.push(text_node(&current_text, &current_marks));
                current_text.clear();
            }
        };
    }

    while let Some(byte) = s.peek() {
        match byte {
            b'{' => {
                s.next();
                depth += 1;
                state_stack.push(*state_stack.last().unwrap_or(&FormatState::default()));
                unicode_skip_stack.push(*unicode_skip_stack.last().unwrap_or(&1));
                if skip_depth.is_none() && peek_starts_skip_destination(&s) {
                    skip_depth = Some(depth);
                }
            }
            b'}' => {
                s.next();
                if skip_depth == Some(depth) {
                    skip_depth = None;
                }
                depth -= 1;
                if depth < 0 {
                    return Err(RtfError::UnbalancedBraces);
                }
                if skip_depth.is_none() {
                    // Flush com as marks do escopo que está fechando, antes
                    // de voltar para as marks do escopo pai — sem isso, a
                    // formatação do grupo filho "vaza" pro texto seguinte.
                    flush_run!();
                }
                state_stack.pop();
                unicode_skip_stack.pop();
                if skip_depth.is_none() {
                    current_marks = state_stack.last().unwrap_or(&FormatState::default()).marks();
                }
            }
            b'\\' => {
                s.next();
                let token = read_backslash_token(&mut s);
                if skip_depth.is_some() {
                    continue;
                }
                match token {
                    Token::Literal(c) => current_text.push(c),
                    Token::Ignored => {}
                    Token::ControlWord(word, param) => match word.as_str() {
                        "par" | "line" => {
                            flush_run!();
                            paragraphs.push(TipTapNode {
                                kind: "paragraph".to_string(),
                                content: if para_runs.is_empty() { None } else { Some(std::mem::take(&mut para_runs)) },
                                ..Default::default()
                            });
                        }
                        "b" => {
                            flush_run!();
                            state_stack.last_mut().unwrap().bold = param != Some(0);
                            current_marks = state_stack.last().unwrap().marks();
                        }
                        "i" => {
                            flush_run!();
                            state_stack.last_mut().unwrap().italic = param != Some(0);
                            current_marks = state_stack.last().unwrap().marks();
                        }
                        "ul" => {
                            flush_run!();
                            state_stack.last_mut().unwrap().underline = param != Some(0);
                            current_marks = state_stack.last().unwrap().marks();
                        }
                        "ulnone" => {
                            flush_run!();
                            state_stack.last_mut().unwrap().underline = false;
                            current_marks = state_stack.last().unwrap().marks();
                        }
                        "strike" => {
                            flush_run!();
                            state_stack.last_mut().unwrap().strike = param != Some(0);
                            current_marks = state_stack.last().unwrap().marks();
                        }
                        "uc" => {
                            *unicode_skip_stack.last_mut().unwrap() = param.unwrap_or(1).max(0);
                        }
                        "u" => {
                            // Não é uma mudança de formatação — não deve
                            // cortar a corrida de texto atual em dois nós.
                            let code = param.unwrap_or(0);
                            let scalar = if code < 0 { (code + 0x10000) as u32 } else { code as u32 };
                            if let Some(ch) = char::from_u32(scalar) {
                                current_text.push(ch);
                            }
                            let skip = *unicode_skip_stack.last().unwrap_or(&1);
                            for _ in 0..skip {
                                skip_one_fallback_unit(&mut s);
                            }
                        }
                        "tab" => current_text.push('\t'),
                        _ => {}
                    },
                }
            }
            b'\r' | b'\n' => {
                // Quebras de linha cruas no arquivo-fonte são só formatação
                // do próprio .rtf (legibilidade), não conteúdo do documento.
                s.next();
            }
            _ => {
                s.next();
                if skip_depth.is_none() {
                    current_text.push(byte as char);
                }
            }
        }
    }

    if depth != 0 {
        return Err(RtfError::UnbalancedBraces);
    }

    flush_run!();
    if !para_runs.is_empty() {
        paragraphs.push(TipTapNode { kind: "paragraph".to_string(), content: Some(para_runs), ..Default::default() });
    }

    Ok(TipTapNode { kind: "doc".to_string(), content: Some(paragraphs), ..Default::default() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_preserves_text_and_marks() {
        let original = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![
                TipTapNode {
                    kind: "paragraph".to_string(),
                    content: Some(vec![
                        text_node("Olá ", &[]),
                        text_node("mundo", &["bold".to_string()]),
                        text_node(" em itálico e sublinhado", &["italic".to_string(), "underline".to_string()]),
                    ]),
                    ..Default::default()
                },
                TipTapNode { kind: "paragraph".to_string(), ..Default::default() },
                TipTapNode {
                    kind: "paragraph".to_string(),
                    content: Some(vec![text_node("terceiro parágrafo, tachado", &["strike".to_string()])]),
                    ..Default::default()
                },
            ]),
            ..Default::default()
        };

        let bytes = write_rtf(&original);
        assert!(bytes.starts_with(b"{\\rtf1"), "deve começar com o cabeçalho padrão de um RTF");

        let rebuilt = read_rtf(&bytes).expect("deve ler o .rtf gerado");
        assert_eq!(rebuilt, original);
    }

    #[test]
    fn round_trip_preserves_accented_characters() {
        let original = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "paragraph".to_string(),
                content: Some(vec![text_node("Configuração de código com ção, çã, é, ê, à", &[])]),
                ..Default::default()
            }]),
            ..Default::default()
        };

        let bytes = write_rtf(&original);
        let rebuilt = read_rtf(&bytes).expect("deve ler o .rtf gerado");
        assert_eq!(rebuilt, original);
    }

    fn generated_rtf_opens_with_libreoffice() {
        let original = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "paragraph".to_string(),
                content: Some(vec![text_node("teste de compatibilidade real, com acentuação", &["bold".to_string()])]),
                ..Default::default()
            }]),
            ..Default::default()
        };
        let bytes = write_rtf(&original);

        let dir = std::env::temp_dir().join(format!("prosa-rtf-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("teste.rtf");
        std::fs::write(&path, &bytes).unwrap();

        let output = std::process::Command::new("soffice")
            .args(["--headless", "--convert-to", "txt", "--outdir"])
            .arg(&dir)
            .arg(&path)
            .output()
            .expect("deve conseguir invocar o soffice");
        assert!(output.status.success(), "LibreOffice deve converter o .rtf gerado sem erro");
        let content = std::fs::read_to_string(dir.join("teste.txt")).unwrap_or_default();
        assert!(
            content.contains("teste de compatibilidade real, com acentuação"),
            "o texto extraído pelo LibreOffice deve bater com o conteúdo original, obtido: {content:?}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    fn reads_rtf_reprocessed_by_libreoffice() {
        let original = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "paragraph".to_string(),
                content: Some(vec![
                    text_node("prefixo simples, ", &[]),
                    text_node("meio em negrito", &["bold".to_string()]),
                    text_node(", sufixo com ção", &[]),
                ]),
                ..Default::default()
            }]),
            ..Default::default()
        };
        let bytes = write_rtf(&original);

        let dir = std::env::temp_dir().join(format!("prosa-rtf-roundtrip-{}", std::process::id()));
        let in_dir = dir.join("in");
        let out_dir = dir.join("out");
        std::fs::create_dir_all(&in_dir).unwrap();
        std::fs::create_dir_all(&out_dir).unwrap();
        let input_path = in_dir.join("entrada.rtf");
        std::fs::write(&input_path, &bytes).unwrap();

        let output = std::process::Command::new("soffice")
            .args(["--headless", "--convert-to", "rtf", "--outdir"])
            .arg(&out_dir)
            .arg(&input_path)
            .output()
            .expect("deve conseguir invocar o soffice");
        assert!(output.status.success(), "LibreOffice deve reconverter o .rtf sem erro");

        let reprocessed_bytes = std::fs::read(out_dir.join("entrada.rtf")).expect("saída do LibreOffice deve existir");
        let rebuilt = read_rtf(&reprocessed_bytes).expect("deve ler o .rtf produzido pelo LibreOffice");

        assert_eq!(rebuilt.plain_text(), original.plain_text());

        let bold_run = rebuilt.content.as_ref().unwrap()[0]
            .content
            .as_ref()
            .unwrap()
            .iter()
            .find(|node| node.text.as_deref() == Some("meio em negrito"));
        assert!(
            bold_run.is_some_and(|node| node.marks.as_ref().is_some_and(|m| m.iter().any(|mk| mk.kind == "bold"))),
            "o trecho em negrito deve continuar marcado como bold após passar pelo LibreOffice"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn libreoffice_compatibility() {
        let _guard = crate::SOFFICE_LOCK.lock().unwrap();
        let has_soffice = std::process::Command::new("soffice").arg("--version").output().is_ok();
        if !has_soffice {
            eprintln!("aviso: LibreOffice (soffice) indisponível, checagens de compatibilidade real puladas");
            return;
        }
        generated_rtf_opens_with_libreoffice();
        reads_rtf_reprocessed_by_libreoffice();
    }
}
