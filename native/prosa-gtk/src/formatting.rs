//! Ponte entre `GtkTextTag` (formatação inline no `GtkTextBuffer`) e as
//! `marks` do modelo de documento (`prosa_doc::Mark`).
//!
//! Cobre apenas negrito/itálico/sublinhado/tachado — a mesma base de
//! `StarterKit`/`Underline` usada pela versão Electron (`src/renderer/editor/editor.ts`),
//! com os mesmos nomes de tipo de mark (`bold`, `italic`, `underline`, `strike`),
//! para que os arquivos `.prosa` continuem compatíveis entre as duas versões.
//!
//! Estrutura de bloco (parágrafo vs. título, tabelas, imagens) ainda não é
//! preservada: cada linha do `GtkTextBuffer` vira um nó `paragraph` ao salvar,
//! e blocos de outros tipos (`heading`, etc.) lidos de um arquivo existente
//! são achatados em texto simples ao carregar.

use gtk::prelude::*;
use gtk::{TextBuffer, TextIter, TextTag};
use prosa_doc::{Mark, TipTapNode};

/// Nomes de mark suportados, iguais aos tipos registrados no editor Electron.
pub const MARK_NAMES: [&str; 4] = ["bold", "italic", "underline", "strike"];

/// Cria e registra na tag table do buffer uma `GtkTextTag` para cada mark suportada.
pub fn setup_mark_tags(buffer: &TextBuffer) {
    let bold = TextTag::builder()
        .name("bold")
        .weight(700) // PANGO_WEIGHT_BOLD
        .build();
    let italic = TextTag::builder().name("italic").style(pango::Style::Italic).build();
    let underline = TextTag::builder()
        .name("underline")
        .underline(pango::Underline::Single)
        .build();
    let strike = TextTag::builder().name("strike").strikethrough(true).build();

    let table = buffer.tag_table();
    table.add(&bold);
    table.add(&italic);
    table.add(&underline);
    table.add(&strike);
}

/// Alterna uma mark sobre a seleção atual: aplica se algum trecho selecionado
/// não tiver a tag, remove se a seleção inteira já estiver marcada.
pub fn toggle_mark(buffer: &TextBuffer, mark_name: &str) {
    let Some((start, end)) = buffer.selection_bounds() else { return };
    let Some(tag) = buffer.tag_table().lookup(mark_name) else { return };

    if range_fully_tagged(&start, &end, &tag) {
        buffer.remove_tag(&tag, &start, &end);
    } else {
        buffer.apply_tag(&tag, &start, &end);
    }
}

fn range_fully_tagged(start: &TextIter, end: &TextIter, tag: &TextTag) -> bool {
    let mut iter = start.clone();
    while &iter < end {
        if !iter.has_tag(tag) {
            return false;
        }
        if !iter.forward_char() {
            break;
        }
    }
    true
}

fn active_mark_names(iter: &TextIter) -> Vec<String> {
    let mut names: Vec<String> = iter
        .tags()
        .iter()
        .filter_map(|tag| tag.name().map(|n| n.to_string()))
        .filter(|name| MARK_NAMES.contains(&name.as_str()))
        .collect();
    names.sort();
    names
}

fn text_node(text: &str, mark_names: &[String]) -> TipTapNode {
    let marks = if mark_names.is_empty() {
        None
    } else {
        Some(
            mark_names
                .iter()
                .map(|kind| Mark { kind: kind.clone(), attrs: None })
                .collect(),
        )
    };
    TipTapNode {
        kind: "text".to_string(),
        text: Some(text.to_string()),
        marks,
        ..Default::default()
    }
}

/// Constrói o nó `paragraph` de uma linha do buffer, dividindo-a em corridas
/// de texto conforme os grupos de marks ativas mudam.
fn paragraph_from_line(buffer: &TextBuffer, line: i32) -> TipTapNode {
    let start = buffer.iter_at_line(line).expect("linha válida");
    // Evita `forward_to_line_end`: com linhas vazias adjacentes (dois `\n`
    // seguidos) seu comportamento pula a linha vazia inteira. Em vez disso,
    // o fim da linha é sempre o início da próxima linha menos o `\n`.
    let end = if line + 1 < buffer.line_count() {
        let mut next_start = buffer.iter_at_line(line + 1).expect("próxima linha válida");
        next_start.backward_char();
        next_start
    } else {
        buffer.end_iter()
    };

    if start == end {
        return TipTapNode { kind: "paragraph".to_string(), ..Default::default() };
    }

    let mut runs = Vec::new();
    let mut run_start = start.clone();
    let mut run_marks = active_mark_names(&run_start);
    let mut cursor = start.clone();

    loop {
        let reached_end = !cursor.forward_char() || cursor >= end;
        let now_marks = if reached_end { Vec::new() } else { active_mark_names(&cursor) };
        if reached_end || now_marks != run_marks {
            let boundary = if reached_end { end.clone() } else { cursor.clone() };
            let text = buffer.text(&run_start, &boundary, false).to_string();
            if !text.is_empty() {
                runs.push(text_node(&text, &run_marks));
            }
            if reached_end {
                break;
            }
            run_start = cursor.clone();
            run_marks = now_marks;
        }
    }

    TipTapNode {
        kind: "paragraph".to_string(),
        content: Some(runs),
        ..Default::default()
    }
}

/// Constrói um `doc` TipTap a partir do conteúdo inteiro do buffer, uma linha
/// por parágrafo, preservando negrito/itálico/sublinhado/tachado.
pub fn doc_from_buffer(buffer: &TextBuffer) -> TipTapNode {
    let line_count = buffer.line_count();
    let paragraphs: Vec<TipTapNode> = (0..line_count).map(|line| paragraph_from_line(buffer, line)).collect();
    TipTapNode {
        kind: "doc".to_string(),
        content: Some(paragraphs),
        ..Default::default()
    }
}

/// Insere um nó (e seus filhos) no fim do buffer, aplicando as tags
/// correspondentes às marks de cada trecho de texto encontrado.
fn insert_node(buffer: &TextBuffer, node: &TipTapNode) {
    if let Some(text) = &node.text {
        let start_offset = buffer.end_iter().offset();
        let mut end_iter = buffer.end_iter();
        buffer.insert(&mut end_iter, text);

        if let Some(marks) = &node.marks {
            let start = buffer.iter_at_offset(start_offset);
            let end = buffer.end_iter();
            for mark in marks {
                if let Some(tag) = buffer.tag_table().lookup(&mark.kind) {
                    buffer.apply_tag(&tag, &start, &end);
                }
            }
        }
    }

    if let Some(children) = &node.content {
        for child in children {
            insert_node(buffer, child);
        }
    }
}

/// Carrega um `doc` TipTap no buffer, um bloco de nível superior por linha,
/// reaplicando as marks suportadas.
pub fn load_doc_into_buffer(buffer: &TextBuffer, doc: &TipTapNode) {
    buffer.set_text("");
    if let Some(blocks) = &doc.content {
        for (index, block) in blocks.iter().enumerate() {
            if index > 0 {
                let mut end_iter = buffer.end_iter();
                buffer.insert(&mut end_iter, "\n");
            }
            insert_node(buffer, block);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn init_gtk() {
        let _ = gtk::init();
    }

    /// Um único #[test]: GTK só pode ser inicializado numa thread do
    /// processo, e o harness de testes usa uma thread nova por #[test].
    #[test]
    fn buffer_mark_round_trips() {
        init_gtk();
        round_trip_preserves_marks();
        multiple_paragraphs_round_trip();
        toggle_mark_applies_and_removes();
    }

    fn first_run_marks(doc: &TipTapNode) -> Vec<String> {
        doc.content.as_ref().unwrap()[0]
            .content
            .as_ref()
            .unwrap()[0]
            .marks
            .as_ref()
            .map(|marks| marks.iter().map(|m| m.kind.clone()).collect())
            .unwrap_or_default()
    }

    fn toggle_mark_applies_and_removes() {
        let buffer = TextBuffer::new(None);
        setup_mark_tags(&buffer);
        buffer.set_text("palavra simples");

        buffer.select_range(&buffer.iter_at_offset(0), &buffer.iter_at_offset(7)); // "palavra"
        toggle_mark(&buffer, "bold");
        let doc = doc_from_buffer(&buffer);
        assert_eq!(
            first_run_marks(&doc),
            vec!["bold".to_string()],
            "primeira aplicação deve marcar em negrito"
        );

        buffer.select_range(&buffer.iter_at_offset(0), &buffer.iter_at_offset(7));
        toggle_mark(&buffer, "bold");
        let doc = doc_from_buffer(&buffer);
        assert!(
            first_run_marks(&doc).is_empty(),
            "segunda aplicação sobre o mesmo trecho deve remover a marca"
        );
    }

    fn round_trip_preserves_marks() {
        let buffer = TextBuffer::new(None);
        setup_mark_tags(&buffer);

        let original = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "paragraph".to_string(),
                content: Some(vec![
                    text_node("Olá ", &[]),
                    text_node("mundo", &["bold".to_string()]),
                    text_node(" em ", &[]),
                    text_node("itálico", &["italic".to_string(), "underline".to_string()]),
                ]),
                ..Default::default()
            }]),
            ..Default::default()
        };

        load_doc_into_buffer(&buffer, &original);
        let rebuilt = doc_from_buffer(&buffer);

        assert_eq!(rebuilt, original);
    }

    fn multiple_paragraphs_round_trip() {
        let buffer = TextBuffer::new(None);
        setup_mark_tags(&buffer);

        let original = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![
                TipTapNode {
                    kind: "paragraph".to_string(),
                    content: Some(vec![text_node("primeira", &["bold".to_string()])]),
                    ..Default::default()
                },
                TipTapNode { kind: "paragraph".to_string(), ..Default::default() },
                TipTapNode {
                    kind: "paragraph".to_string(),
                    content: Some(vec![text_node("terceira", &[])]),
                    ..Default::default()
                },
            ]),
            ..Default::default()
        };

        load_doc_into_buffer(&buffer, &original);
        let rebuilt = doc_from_buffer(&buffer);
        assert_eq!(rebuilt, original);
    }
}
