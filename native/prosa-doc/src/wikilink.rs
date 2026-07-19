//! Wikilinks `[[alvo]]` entre documentos.
//!
//! Espelha a mark `wikilink` do editor Electron
//! (`src/renderer/editor/extensions/wikilink.ts`) e a extração de
//! `src/shared/document-utils.ts::extractWikilinks`: um mark `Mark{kind:
//! "wikilink", attrs: {href}}` sobre um trecho de texto, com
//! `href = "prosa://wiki/<alvo codificado>"`. O código de codificação/decodificação
//! usa percent-encoding equivalente a `encodeURIComponent`/`decodeURIComponent`
//! do JS, então arquivos `.prosa` continuam interoperáveis entre as duas versões.

use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};

use crate::TipTapNode;

const WIKI_PREFIX: &str = "prosa://wiki/";

/// Monta o `href` de uma wikilink a partir do alvo (nome/título do documento referenciado).
pub fn wiki_href(target: &str) -> String {
    format!("{WIKI_PREFIX}{}", utf8_percent_encode(target, NON_ALPHANUMERIC))
}

/// Decodifica o alvo de um `href` de wikilink, se for um (prefixo `prosa://wiki/`).
pub fn decode_wiki_href(href: &str) -> Option<String> {
    let encoded = href.strip_prefix(WIKI_PREFIX)?;
    Some(percent_decode_str(encoded).decode_utf8_lossy().into_owned())
}

/// Extrai os alvos de todas as wikilinks presentes no documento.
pub fn extract_wikilinks(doc: &TipTapNode) -> Vec<String> {
    let mut links = Vec::new();

    fn walk(node: &TipTapNode, links: &mut Vec<String>) {
        if let Some(marks) = &node.marks {
            for mark in marks {
                if mark.kind != "wikilink" {
                    continue;
                }
                let Some(href) = mark.attrs.as_ref().and_then(|attrs| attrs.get("href")).and_then(|v| v.as_str()) else { continue };
                if let Some(target) = decode_wiki_href(href) {
                    if !links.contains(&target) {
                        links.push(target);
                    }
                }
            }
        }
        if let Some(children) = &node.content {
            for child in children {
                walk(child, links);
            }
        }
    }

    walk(doc, &mut links);
    links
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Mark;

    #[test]
    fn wiki_href_round_trips_through_encode_decode() {
        let href = wiki_href("Capítulo 1: Início");
        assert!(href.starts_with("prosa://wiki/"));
        assert_eq!(decode_wiki_href(&href).as_deref(), Some("Capítulo 1: Início"));
    }

    #[test]
    fn decode_wiki_href_rejects_other_schemes() {
        assert_eq!(decode_wiki_href("https://example.com"), None);
    }

    fn wikilink_text_node(text: &str, target: &str) -> TipTapNode {
        TipTapNode {
            kind: "text".to_string(),
            text: Some(text.to_string()),
            marks: Some(vec![Mark { kind: "wikilink".to_string(), attrs: Some(serde_json::json!({ "href": wiki_href(target) })) }]),
            ..Default::default()
        }
    }

    #[test]
    fn extract_wikilinks_walks_nested_content() {
        let doc = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "paragraph".to_string(),
                content: Some(vec![
                    TipTapNode { kind: "text".to_string(), text: Some("veja ".to_string()), ..Default::default() },
                    wikilink_text_node("Outro Documento", "Outro Documento"),
                    TipTapNode { kind: "text".to_string(), text: Some(" e também ".to_string()), ..Default::default() },
                    wikilink_text_node("Terceiro", "Terceiro"),
                ]),
                ..Default::default()
            }]),
            ..Default::default()
        };

        assert_eq!(extract_wikilinks(&doc), vec!["Outro Documento".to_string(), "Terceiro".to_string()]);
    }

    #[test]
    fn extract_wikilinks_ignores_other_marks_and_dedupes() {
        let doc = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "paragraph".to_string(),
                content: Some(vec![
                    TipTapNode {
                        kind: "text".to_string(),
                        text: Some("negrito".to_string()),
                        marks: Some(vec![Mark { kind: "bold".to_string(), attrs: None }]),
                        ..Default::default()
                    },
                    wikilink_text_node("Repetido", "Repetido"),
                    wikilink_text_node("Repetido de novo", "Repetido"),
                ]),
                ..Default::default()
            }]),
            ..Default::default()
        };

        assert_eq!(extract_wikilinks(&doc), vec!["Repetido".to_string()]);
    }

    #[test]
    fn extract_wikilinks_empty_document_has_none() {
        assert!(extract_wikilinks(&TipTapNode::empty_doc()).is_empty());
    }
}
