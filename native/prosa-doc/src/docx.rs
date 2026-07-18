//! Leitura e escrita de `.docx` (Office Open XML / WordprocessingML).
//!
//! Cobre o mesmo subconjunto que o resto do editor nativo já suporta:
//! parágrafos com marks de negrito/itálico/sublinhado/tachado (ver
//! `MARK_NAMES` em `prosa-gtk/src/formatting.rs`). Tabelas, imagens, listas,
//! estilos nomeados e títulos não são preservados — o texto é extraído, a
//! formatação inline suportada é mantida, o resto é descartado
//! silenciosamente (mesmo padrão "melhor esforço" do restante do MVP).
//!
//! Um `.docx` é um zip contendo XML. Para leitura, usamos um parser real
//! (`quick_xml`) porque o documento pode vir do Word/LibreOffice com
//! variações de atributos e ordem. Para escrita, geramos o XML na mão: só
//! produzimos um subconjunto fixo e já conhecido, então não há necessidade
//! de um writer XML genérico.

use std::io::{Read, Write};

use quick_xml::events::{BytesStart, Event};
use quick_xml::reader::Reader;

use crate::{Mark, TipTapNode};

/// Erros de leitura/escrita de um arquivo `.docx`.
#[derive(Debug, thiserror::Error)]
pub enum DocxError {
    #[error("falha ao acessar o arquivo .docx: {0}")]
    Io(#[from] std::io::Error),
    #[error("falha ao ler o contêiner .docx (zip): {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("falha ao interpretar o XML do .docx: {0}")]
    Xml(#[from] quick_xml::Error),
    #[error("o .docx não contém word/document.xml")]
    MissingDocumentXml,
}

fn local_name_string(name: quick_xml::name::QName) -> String {
    String::from_utf8_lossy(name.local_name().as_ref()).into_owned()
}

fn attr_val(e: &BytesStart) -> Option<String> {
    e.attributes().flatten().find_map(|a| {
        let key_local = String::from_utf8_lossy(a.key.local_name().as_ref()).into_owned();
        if key_local == "val" {
            Some(String::from_utf8_lossy(&a.value).into_owned())
        } else {
            None
        }
    })
}

/// `<w:b/>`/`<w:i/>`/`<w:strike/>`: presentes = ligado, a menos que
/// `w:val="0"`/`"false"` explicitamente desligue.
fn is_flag_on(e: &BytesStart) -> bool {
    !matches!(attr_val(e).as_deref(), Some("0") | Some("false"))
}

/// `<w:u w:val="...">`: o valor é o estilo do sublinhado, não um booleano.
/// `"none"` desliga; qualquer outro estilo conta como sublinhado ligado.
fn is_underline_on(e: &BytesStart) -> bool {
    attr_val(e).as_deref() != Some("none")
}

fn push_unique(marks: &mut Vec<String>, name: &str) {
    if !marks.iter().any(|m| m == name) {
        marks.push(name.to_string());
    }
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

/// Interpreta o XML de `word/document.xml` e constrói o `doc` TipTap.
fn parse_document_xml(xml: &str) -> Result<TipTapNode, DocxError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut paragraphs: Vec<TipTapNode> = Vec::new();
    let mut para_runs: Vec<TipTapNode> = Vec::new();
    let mut in_run_props = false;
    let mut in_text_tag = false;
    let mut current_marks: Vec<String> = Vec::new();
    let mut current_text = String::new();

    loop {
        match reader.read_event()? {
            Event::Eof => break,
            Event::Start(e) => {
                let name = local_name_string(e.name());
                match name.as_str() {
                    "p" => para_runs.clear(),
                    "r" => {
                        current_marks.clear();
                        current_text.clear();
                    }
                    "rPr" => in_run_props = true,
                    "t" => in_text_tag = true,
                    "b" if in_run_props && is_flag_on(&e) => push_unique(&mut current_marks, "bold"),
                    "i" if in_run_props && is_flag_on(&e) => push_unique(&mut current_marks, "italic"),
                    "u" if in_run_props && is_underline_on(&e) => push_unique(&mut current_marks, "underline"),
                    "strike" if in_run_props && is_flag_on(&e) => push_unique(&mut current_marks, "strike"),
                    _ => {}
                }
            }
            Event::Empty(e) => {
                let name = local_name_string(e.name());
                match name.as_str() {
                    "br" => current_text.push('\n'),
                    "b" if in_run_props && is_flag_on(&e) => push_unique(&mut current_marks, "bold"),
                    "i" if in_run_props && is_flag_on(&e) => push_unique(&mut current_marks, "italic"),
                    "u" if in_run_props && is_underline_on(&e) => push_unique(&mut current_marks, "underline"),
                    "strike" if in_run_props && is_flag_on(&e) => push_unique(&mut current_marks, "strike"),
                    _ => {}
                }
            }
            Event::Text(e) => {
                if in_text_tag {
                    let decoded = e.decode().map_err(quick_xml::Error::from)?;
                    let unescaped = quick_xml::escape::unescape(&decoded).map_err(quick_xml::Error::from)?;
                    current_text.push_str(&unescaped);
                }
            }
            Event::End(e) => {
                let name = local_name_string(e.name());
                match name.as_str() {
                    "t" => in_text_tag = false,
                    "rPr" => in_run_props = false,
                    "r" => {
                        if !current_text.is_empty() {
                            para_runs.push(text_node(&current_text, &current_marks));
                        }
                    }
                    "p" => {
                        paragraphs.push(TipTapNode {
                            kind: "paragraph".to_string(),
                            content: if para_runs.is_empty() { None } else { Some(std::mem::take(&mut para_runs)) },
                            ..Default::default()
                        });
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    Ok(TipTapNode { kind: "doc".to_string(), content: Some(paragraphs), ..Default::default() })
}

/// Lê um arquivo `.docx` (bytes do zip) e retorna o `doc` TipTap equivalente.
pub fn read_docx(bytes: &[u8]) -> Result<TipTapNode, DocxError> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)?;
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|_| DocxError::MissingDocumentXml)?
        .read_to_string(&mut xml)?;
    parse_document_xml(&xml)
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn run_xml(node: &TipTapNode, out: &mut String) {
    let Some(text) = &node.text else { return };
    out.push_str("<w:r>");
    let marks = node.marks.as_deref().unwrap_or(&[]);
    if !marks.is_empty() {
        out.push_str("<w:rPr>");
        for mark in marks {
            match mark.kind.as_str() {
                "bold" => out.push_str("<w:b/>"),
                "italic" => out.push_str("<w:i/>"),
                "underline" => out.push_str(r#"<w:u w:val="single"/>"#),
                "strike" => out.push_str("<w:strike/>"),
                _ => {}
            }
        }
        out.push_str("</w:rPr>");
    }
    out.push_str(r#"<w:t xml:space="preserve">"#);
    out.push_str(&escape_xml(text));
    out.push_str("</w:t></w:r>");
}

fn paragraph_xml(node: &TipTapNode, out: &mut String) {
    out.push_str("<w:p>");
    if let Some(children) = &node.content {
        for child in children {
            run_xml(child, out);
        }
    }
    out.push_str("</w:p>");
}

/// A4 com as margens do preset "academic" (ver `prosa-gtk/src/print.rs`),
/// em twips (1/1440 de polegada) — mantém a página do `.docx` consistente
/// com a exportação para PDF.
const SECT_PR_XML: &str = r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1411" w:right="1138" w:bottom="1411" w:left="1138"/></w:sectPr>"#;

fn build_document_xml(doc: &TipTapNode) -> String {
    let mut body = String::new();
    if let Some(blocks) = &doc.content {
        for block in blocks {
            paragraph_xml(block, &mut body);
        }
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>{body}{SECT_PR_XML}</w:body>
</w:document>"#
    )
}

const CONTENT_TYPES_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#;

const ROOT_RELS_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;

/// Serializa o `doc` TipTap como um `.docx` válido (zip com as três partes
/// mínimas: Content_Types, relacionamento raiz e o próprio document.xml).
pub fn write_docx(doc: &TipTapNode) -> Result<Vec<u8>, DocxError> {
    let document_xml = build_document_xml(doc);
    let mut buf = Vec::new();
    {
        let cursor = std::io::Cursor::new(&mut buf);
        let mut zip = zip::ZipWriter::new(cursor);
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("[Content_Types].xml", options)?;
        zip.write_all(CONTENT_TYPES_XML.as_bytes())?;

        zip.start_file("_rels/.rels", options)?;
        zip.write_all(ROOT_RELS_XML.as_bytes())?;

        zip.start_file("word/document.xml", options)?;
        zip.write_all(document_xml.as_bytes())?;

        zip.finish()?;
    }
    Ok(buf)
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

        let bytes = write_docx(&original).expect("deve gerar o .docx");
        assert!(bytes.starts_with(b"PK"), "um .docx é um zip (assinatura PK)");

        let rebuilt = read_docx(&bytes).expect("deve ler o .docx gerado");
        assert_eq!(rebuilt, original);
    }

    /// Roda com `soffice --headless`. Duas invocações concorrentes do
    /// LibreOffice disputam o lock do mesmo perfil de usuário e falham
    /// aleatoriamente, então todos os testes que chamam `soffice` são
    /// chamados sequencialmente a partir de um único `#[test]`
    /// (`libreoffice_compatibility`) em vez de terem `#[test]` próprio.
    fn generated_docx_opens_with_libreoffice() {
        let original = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "paragraph".to_string(),
                content: Some(vec![text_node("teste de compatibilidade real", &["bold".to_string()])]),
                ..Default::default()
            }]),
            ..Default::default()
        };
        let bytes = write_docx(&original).unwrap();

        let dir = std::env::temp_dir().join(format!("prosa-docx-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("teste.docx");
        std::fs::write(&path, &bytes).unwrap();

        let output = std::process::Command::new("soffice")
            .args(["--headless", "--convert-to", "txt", "--outdir"])
            .arg(&dir)
            .arg(&path)
            .output()
            .expect("deve conseguir invocar o soffice");
        assert!(output.status.success(), "LibreOffice deve converter o .docx gerado sem erro");
        let txt_path = dir.join("teste.txt");
        let content = std::fs::read_to_string(&txt_path).unwrap_or_default();
        assert!(
            content.contains("teste de compatibilidade real"),
            "o texto extraído pelo LibreOffice deve bater com o conteúdo original, obtido: {content:?}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    /// A função anterior confirma que o LibreOffice lê o que nós escrevemos.
    /// Esta confirma o sentido oposto, mais importante na prática: que o
    /// nosso `read_docx` entende um `.docx` genuinamente reprocessado pelo
    /// LibreOffice (namespaces/atributos completos, não o XML mínimo que
    /// nós mesmos geramos) — arquivos reais de usuário vêm do Word/LibreOffice,
    /// não do nosso próprio writer.
    fn reads_docx_reprocessed_by_libreoffice() {
        let original = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "paragraph".to_string(),
                content: Some(vec![
                    text_node("prefixo simples, ", &[]),
                    text_node("meio em negrito", &["bold".to_string()]),
                    text_node(", sufixo simples", &[]),
                ]),
                ..Default::default()
            }]),
            ..Default::default()
        };
        let bytes = write_docx(&original).unwrap();

        let dir = std::env::temp_dir().join(format!("prosa-docx-roundtrip-{}", std::process::id()));
        let in_dir = dir.join("in");
        let out_dir = dir.join("out");
        std::fs::create_dir_all(&in_dir).unwrap();
        std::fs::create_dir_all(&out_dir).unwrap();
        let input_path = in_dir.join("entrada.docx");
        std::fs::write(&input_path, &bytes).unwrap();

        // Força o LibreOffice a reabrir e regravar o arquivo com seu próprio
        // serializador (XML bem mais completo que o nosso). Precisa de um
        // diretório de saída diferente do de entrada: o soffice recusa
        // "converter" um arquivo para o mesmo caminho de origem.
        let output = std::process::Command::new("soffice")
            .args(["--headless", "--convert-to", "docx", "--outdir"])
            .arg(&out_dir)
            .arg(&input_path)
            .output()
            .expect("deve conseguir invocar o soffice");
        assert!(output.status.success(), "LibreOffice deve reconverter o .docx sem erro");

        let reprocessed_bytes = std::fs::read(out_dir.join("entrada.docx")).expect("saída do LibreOffice deve existir");
        let rebuilt = read_docx(&reprocessed_bytes).expect("deve ler o .docx produzido pelo LibreOffice");

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
        let has_soffice = std::process::Command::new("soffice").arg("--version").output().is_ok();
        if !has_soffice {
            eprintln!("aviso: LibreOffice (soffice) indisponível, checagens de compatibilidade real puladas");
            return;
        }
        generated_docx_opens_with_libreoffice();
        reads_docx_reprocessed_by_libreoffice();
    }
}
