//! Leitura e escrita de `.odt` (OpenDocument Text / LibreOffice Writer).
//!
//! Mesmo escopo do `docx.rs`: parágrafos com as marks já suportadas
//! (bold/italic/underline/strike). Tabelas, imagens, listas, estilos
//! nomeados e títulos não são preservados.
//!
//! Diferença estrutural importante em relação ao `.docx`: o ODF não marca
//! negrito/itálico inline (não existe um `<w:b/>` equivalente solto no
//! texto) — a formatação é sempre por referência a um estilo declarado em
//! `<office:automatic-styles>` (`<style:style style:family="text">` com
//! `<style:text-properties fo:font-weight="bold" .../>`), e o texto usa
//! `<text:span text:style-name="T1">`. Por isso a leitura é em duas etapas:
//! primeiro resolve o mapa nome-do-estilo → marks, depois percorre o corpo
//! do documento aplicando esse mapa a cada `text:span`.

use std::collections::BTreeMap;
use std::io::{Read, Write};

use quick_xml::events::Event;
use quick_xml::reader::Reader;

use crate::xml_util::{attr_by_local_name, local_name_string};
use crate::{Mark, TipTapNode};

/// Erros de leitura/escrita de um arquivo `.odt`.
#[derive(Debug, thiserror::Error)]
pub enum OdtError {
    #[error("falha ao acessar o arquivo .odt: {0}")]
    Io(#[from] std::io::Error),
    #[error("falha ao ler o contêiner .odt (zip): {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("falha ao interpretar o XML do .odt: {0}")]
    Xml(#[from] quick_xml::Error),
    #[error("o .odt não contém content.xml")]
    MissingContentXml,
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

/// Lê `<style:text-properties>` e devolve as marks equivalentes.
fn marks_from_text_properties(e: &quick_xml::events::BytesStart) -> Vec<String> {
    let mut marks = Vec::new();
    if attr_by_local_name(e, "font-weight").as_deref() == Some("bold") {
        marks.push("bold".to_string());
    }
    if attr_by_local_name(e, "font-style").as_deref() == Some("italic") {
        marks.push("italic".to_string());
    }
    if attr_by_local_name(e, "text-underline-style").is_some_and(|v| v != "none") {
        marks.push("underline".to_string());
    }
    if attr_by_local_name(e, "text-line-through-style").is_some_and(|v| v != "none") {
        marks.push("strike".to_string());
    }
    marks
}

/// Interpreta o XML de `content.xml` e constrói o `doc` TipTap.
fn parse_content_xml(xml: &str) -> Result<TipTapNode, OdtError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    // Fase 1 (implícita): como `automatic-styles` sempre vem antes de `body`
    // no schema ODF, um único passo com um mapa acumulado já basta — quando
    // chegarmos aos `text:span` do corpo, o mapa de estilos já está completo.
    let mut style_marks: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut current_style_name: Option<String> = None;
    let mut current_style_is_text_family = false;

    let mut paragraphs: Vec<TipTapNode> = Vec::new();
    let mut para_runs: Vec<TipTapNode> = Vec::new();
    let mut span_style_stack: Vec<Vec<String>> = Vec::new();
    let mut current_text = String::new();
    // Ao contrário do .docx (que envolve texto em <w:t>), o ODF põe texto
    // direto dentro de <text:p>/<text:span> — sem esse controle, espaços em
    // branco entre tags no nível do documento (fora de qualquer parágrafo)
    // seriam acumulados como se fossem conteúdo real.
    let mut in_paragraph = false;

    /// Marks efetivas do escopo mais interno (span aninhado, se houver).
    fn active_marks(stack: &[Vec<String>]) -> Vec<String> {
        stack.last().cloned().unwrap_or_default()
    }

    loop {
        match reader.read_event()? {
            Event::Eof => break,
            Event::Start(e) => {
                let name = local_name_string(e.name());
                match name.as_str() {
                    "style" => {
                        current_style_name = attr_by_local_name(&e, "name");
                        current_style_is_text_family = attr_by_local_name(&e, "family").as_deref() == Some("text");
                    }
                    "p" | "h" => {
                        para_runs.clear();
                        in_paragraph = true;
                    }
                    "span" => {
                        let marks = attr_by_local_name(&e, "style-name")
                            .and_then(|name| style_marks.get(&name).cloned())
                            .unwrap_or_default();
                        if !current_text.is_empty() {
                            para_runs.push(text_node(&current_text, &active_marks(&span_style_stack)));
                            current_text.clear();
                        }
                        span_style_stack.push(marks);
                    }
                    _ => {}
                }
            }
            Event::Empty(e) => {
                let name = local_name_string(e.name());
                match name.as_str() {
                    "text-properties" if current_style_is_text_family => {
                        if let Some(style_name) = &current_style_name {
                            style_marks.insert(style_name.clone(), marks_from_text_properties(&e));
                        }
                    }
                    "p" | "h" => paragraphs.push(TipTapNode { kind: "paragraph".to_string(), ..Default::default() }),
                    "line-break" => current_text.push('\n'),
                    "s" => {
                        let count: usize = attr_by_local_name(&e, "c").and_then(|c| c.parse().ok()).unwrap_or(1);
                        current_text.extend(std::iter::repeat_n(' ', count.max(1)));
                    }
                    _ => {}
                }
            }
            Event::Text(e) => {
                if in_paragraph {
                    let decoded = e.decode().map_err(quick_xml::Error::from)?;
                    let unescaped = quick_xml::escape::unescape(&decoded).map_err(quick_xml::Error::from)?;
                    current_text.push_str(&unescaped);
                }
            }
            Event::End(e) => {
                let name = local_name_string(e.name());
                match name.as_str() {
                    "text-properties" => {}
                    "style" => {
                        current_style_name = None;
                        current_style_is_text_family = false;
                    }
                    "span" => {
                        if !current_text.is_empty() {
                            para_runs.push(text_node(&current_text, &active_marks(&span_style_stack)));
                            current_text.clear();
                        }
                        span_style_stack.pop();
                    }
                    "p" | "h" => {
                        if !current_text.is_empty() {
                            para_runs.push(text_node(&current_text, &active_marks(&span_style_stack)));
                            current_text.clear();
                        }
                        paragraphs.push(TipTapNode {
                            kind: "paragraph".to_string(),
                            content: if para_runs.is_empty() { None } else { Some(std::mem::take(&mut para_runs)) },
                            ..Default::default()
                        });
                        in_paragraph = false;
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    Ok(TipTapNode { kind: "doc".to_string(), content: Some(paragraphs), ..Default::default() })
}

/// Lê um arquivo `.odt` (bytes do zip) e retorna o `doc` TipTap equivalente.
pub fn read_odt(bytes: &[u8]) -> Result<TipTapNode, OdtError> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)?;
    let mut xml = String::new();
    archive.by_name("content.xml").map_err(|_| OdtError::MissingContentXml)?.read_to_string(&mut xml)?;
    parse_content_xml(&xml)
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Propriedades ODF (`fo:`/`style:`) de uma combinação de marks, na mesma
/// ordem canônica usada como chave de deduplicação dos estilos automáticos.
fn text_properties_xml(marks: &[String]) -> String {
    let mut props = String::new();
    if marks.iter().any(|m| m == "bold") {
        props.push_str(r#" fo:font-weight="bold""#);
    }
    if marks.iter().any(|m| m == "italic") {
        props.push_str(r#" fo:font-style="italic""#);
    }
    if marks.iter().any(|m| m == "underline") {
        props.push_str(r#" style:text-underline-style="solid" style:text-underline-type="single""#);
    }
    if marks.iter().any(|m| m == "strike") {
        props.push_str(r#" style:text-line-through-style="solid" style:text-line-through-type="single""#);
    }
    props
}

fn collect_mark_sets(node: &TipTapNode, sets: &mut Vec<Vec<String>>) {
    if node.text.is_some() {
        if let Some(marks) = &node.marks {
            let mut kinds: Vec<String> = marks.iter().map(|m| m.kind.clone()).collect();
            kinds.sort();
            if !kinds.is_empty() && !sets.contains(&kinds) {
                sets.push(kinds);
            }
        }
    }
    if let Some(children) = &node.content {
        for child in children {
            collect_mark_sets(child, sets);
        }
    }
}

fn run_xml(node: &TipTapNode, style_names: &BTreeMap<Vec<String>, String>, out: &mut String) {
    let Some(text) = &node.text else { return };
    let mut kinds: Vec<String> = node.marks.as_deref().unwrap_or(&[]).iter().map(|m| m.kind.clone()).collect();
    kinds.sort();

    if kinds.is_empty() {
        out.push_str(&escape_xml(text));
    } else if let Some(style_name) = style_names.get(&kinds) {
        out.push_str(&format!(r#"<text:span text:style-name="{style_name}">"#));
        out.push_str(&escape_xml(text));
        out.push_str("</text:span>");
    } else {
        out.push_str(&escape_xml(text));
    }
}

fn paragraph_xml(node: &TipTapNode, style_names: &BTreeMap<Vec<String>, String>, out: &mut String) {
    if let Some(children) = &node.content {
        if children.is_empty() {
            out.push_str("<text:p/>");
        } else {
            out.push_str("<text:p>");
            for child in children {
                run_xml(child, style_names, out);
            }
            out.push_str("</text:p>");
        }
    } else {
        out.push_str("<text:p/>");
    }
}

const CONTENT_XML_NAMESPACES: &str = r#"xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0""#;

fn build_content_xml(doc: &TipTapNode) -> String {
    let mut mark_sets = Vec::new();
    if let Some(blocks) = &doc.content {
        for block in blocks {
            collect_mark_sets(block, &mut mark_sets);
        }
    }

    let mut automatic_styles = String::new();
    let mut style_names = BTreeMap::new();
    for (index, kinds) in mark_sets.iter().enumerate() {
        let style_name = format!("T{}", index + 1);
        automatic_styles.push_str(&format!(
            r#"<style:style style:name="{style_name}" style:family="text"><style:text-properties{}/></style:style>"#,
            text_properties_xml(kinds)
        ));
        style_names.insert(kinds.clone(), style_name);
    }

    let mut body = String::new();
    if let Some(blocks) = &doc.content {
        for block in blocks {
            paragraph_xml(block, &style_names, &mut body);
        }
    }

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<office:document-content {CONTENT_XML_NAMESPACES} office:version="1.2">
<office:automatic-styles>{automatic_styles}</office:automatic-styles>
<office:body><office:text>{body}</office:text></office:body>
</office:document-content>"#
    )
}

const MIMETYPE: &str = "application/vnd.oasis.opendocument.text";

const MANIFEST_XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>"#;

/// Serializa o `doc` TipTap como um `.odt` válido.
///
/// `mimetype` precisa ser o primeiro arquivo do zip e sem compressão — é a
/// convenção que ferramentas de detecção de formato (`file`, navegadores)
/// usam para reconhecer um ODF sem precisar abrir o zip inteiro.
pub fn write_odt(doc: &TipTapNode) -> Result<Vec<u8>, OdtError> {
    let content_xml = build_content_xml(doc);
    let mut buf = Vec::new();
    {
        let cursor = std::io::Cursor::new(&mut buf);
        let mut zip = zip::ZipWriter::new(cursor);

        let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.start_file("mimetype", stored)?;
        zip.write_all(MIMETYPE.as_bytes())?;

        let deflated = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("META-INF/manifest.xml", deflated)?;
        zip.write_all(MANIFEST_XML.as_bytes())?;

        zip.start_file("content.xml", deflated)?;
        zip.write_all(content_xml.as_bytes())?;

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

        let bytes = write_odt(&original).expect("deve gerar o .odt");
        assert!(bytes.starts_with(b"PK"), "um .odt é um zip (assinatura PK)");

        let rebuilt = read_odt(&bytes).expect("deve ler o .odt gerado");
        assert_eq!(rebuilt, original);
    }

    /// Roda com `soffice --headless`. Ver a mesma nota em `docx::tests`
    /// sobre por que os dois sentidos de compatibilidade são chamados a
    /// partir de um único `#[test]` (duas invocações concorrentes do
    /// LibreOffice disputam o lock do mesmo perfil de usuário).
    fn generated_odt_opens_with_libreoffice() {
        let original = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "paragraph".to_string(),
                content: Some(vec![text_node("teste de compatibilidade real", &["bold".to_string()])]),
                ..Default::default()
            }]),
            ..Default::default()
        };
        let bytes = write_odt(&original).unwrap();

        let dir = std::env::temp_dir().join(format!("prosa-odt-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("teste.odt");
        std::fs::write(&path, &bytes).unwrap();

        let output = std::process::Command::new("soffice")
            .args(["--headless", "--convert-to", "txt", "--outdir"])
            .arg(&dir)
            .arg(&path)
            .output()
            .expect("deve conseguir invocar o soffice");
        assert!(output.status.success(), "LibreOffice deve converter o .odt gerado sem erro");
        let content = std::fs::read_to_string(dir.join("teste.txt")).unwrap_or_default();
        assert!(
            content.contains("teste de compatibilidade real"),
            "o texto extraído pelo LibreOffice deve bater com o conteúdo original, obtido: {content:?}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    fn reads_odt_reprocessed_by_libreoffice() {
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
        let bytes = write_odt(&original).unwrap();

        let dir = std::env::temp_dir().join(format!("prosa-odt-roundtrip-{}", std::process::id()));
        let in_dir = dir.join("in");
        let out_dir = dir.join("out");
        std::fs::create_dir_all(&in_dir).unwrap();
        std::fs::create_dir_all(&out_dir).unwrap();
        let input_path = in_dir.join("entrada.odt");
        std::fs::write(&input_path, &bytes).unwrap();

        let output = std::process::Command::new("soffice")
            .args(["--headless", "--convert-to", "odt", "--outdir"])
            .arg(&out_dir)
            .arg(&input_path)
            .output()
            .expect("deve conseguir invocar o soffice");
        assert!(output.status.success(), "LibreOffice deve reconverter o .odt sem erro");

        let reprocessed_bytes = std::fs::read(out_dir.join("entrada.odt")).expect("saída do LibreOffice deve existir");
        let rebuilt = read_odt(&reprocessed_bytes).expect("deve ler o .odt produzido pelo LibreOffice");

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
        generated_odt_opens_with_libreoffice();
        reads_odt_reprocessed_by_libreoffice();
    }
}
