//! Modelo de documento nativo do Prosa.
//!
//! Espelha o schema JSON usado hoje pela versão Electron/TipTap
//! (`src/shared/types.ts`), para que arquivos `.prosa` existentes continuem
//! abrindo/salvando sem conversão entre as duas versões do app.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub mod ai;
pub mod docx;
pub mod odt;
pub mod rtf;
pub mod wikilink;
pub mod workspace;
mod xml_util;

/// Duas invocações concorrentes de `soffice --headless` disputam o lock do
/// mesmo perfil de usuário do LibreOffice e falham aleatoriamente — os
/// testes de compatibilidade real de cada formato (`docx`, `odt`, ...)
/// tomam este mutex antes de invocar `soffice`, já que o test runner do
/// Rust roda os `#[test]` de módulos diferentes em paralelo por padrão.
#[cfg(test)]
pub(crate) static SOFFICE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Nó de documento ProseMirror/TipTap serializado em JSON.
///
/// Espelha `TipTapJSON` em `src/shared/types.ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TipTapNode {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<TipTapNode>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attrs: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marks: Option<Vec<Mark>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// Marca de formatação inline (negrito, itálico, cor, etc).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Mark {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attrs: Option<Value>,
}

/// Metadados de um documento Prosa.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocumentMetadata {
    pub title: String,
    pub author: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "modifiedAt")]
    pub modified_at: String,
}

/// Tipo de nota suportado pelo documento.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteKind {
    Footnote,
    Endnote,
}

/// Estrutura persistida de uma nota.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NoteEntry {
    pub id: String,
    pub kind: NoteKind,
    pub text: String,
}

/// Estrutura do arquivo nativo `.prosa` (JSON).
///
/// Espelha `ProsaFile` em `src/shared/types.ts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProsaFile {
    pub version: u32,
    pub content: TipTapNode,
    pub metadata: DocumentMetadata,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<HashMap<String, NoteEntry>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer: Option<String>,
}

/// Erros de leitura/escrita de um arquivo `.prosa`.
#[derive(Debug, thiserror::Error)]
pub enum ProsaError {
    #[error("falha ao acessar arquivo .prosa: {0}")]
    Io(#[from] std::io::Error),
    #[error("falha ao interpretar JSON do arquivo .prosa: {0}")]
    Json(#[from] serde_json::Error),
}

impl TipTapNode {
    /// Documento vazio com um único parágrafo vazio, usado em "Novo documento".
    pub fn empty_doc() -> Self {
        TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "paragraph".to_string(),
                ..Default::default()
            }]),
            ..Default::default()
        }
    }

    /// Constrói um `doc` TipTap a partir de texto puro, uma linha por parágrafo.
    ///
    /// Usado pelo editor nativo (MVP baseado em `GtkTextView`, sem marks/estrutura
    /// rica ainda — ver issue "Fase 1: Editor de rich text básico sobre GtkTextView").
    pub fn doc_from_plain_text(text: &str) -> Self {
        let paragraphs: Vec<TipTapNode> = text
            .split('\n')
            .map(|line| {
                if line.is_empty() {
                    TipTapNode {
                        kind: "paragraph".to_string(),
                        ..Default::default()
                    }
                } else {
                    TipTapNode {
                        kind: "paragraph".to_string(),
                        content: Some(vec![TipTapNode {
                            kind: "text".to_string(),
                            text: Some(line.to_string()),
                            ..Default::default()
                        }]),
                        ..Default::default()
                    }
                }
            })
            .collect();
        TipTapNode {
            kind: "doc".to_string(),
            content: Some(paragraphs),
            ..Default::default()
        }
    }

    /// Extrai o texto puro do nó, uma linha por bloco de nível superior.
    ///
    /// Perde formatação/estrutura (marks, tabelas, imagens) — serve para
    /// alimentar a superfície de edição simples do MVP nativo.
    pub fn plain_text(&self) -> String {
        fn walk(node: &TipTapNode, out: &mut String) {
            if let Some(text) = &node.text {
                out.push_str(text);
            }
            if let Some(children) = &node.content {
                for child in children {
                    walk(child, out);
                }
            }
        }

        let mut out = String::new();
        if let Some(children) = &self.content {
            for (i, child) in children.iter().enumerate() {
                if i > 0 {
                    out.push('\n');
                }
                walk(child, &mut out);
            }
        }
        out
    }
}

impl ProsaFile {
    /// Cria um novo documento Prosa vazio.
    pub fn new(title: impl Into<String>, author: impl Into<String>, now_iso: impl Into<String>) -> Self {
        let now_iso = now_iso.into();
        ProsaFile {
            version: 1,
            content: TipTapNode::empty_doc(),
            metadata: DocumentMetadata {
                title: title.into(),
                author: author.into(),
                created_at: now_iso.clone(),
                modified_at: now_iso,
            },
            notes: None,
            header: None,
            footer: None,
        }
    }

    /// Lê e interpreta um arquivo `.prosa` do disco.
    pub fn load(path: &Path) -> Result<Self, ProsaError> {
        let data = std::fs::read_to_string(path)?;
        Ok(serde_json::from_str(&data)?)
    }

    /// Interpreta o conteúdo (já lido) de um arquivo `.prosa`.
    pub fn from_str(data: &str) -> Result<Self, ProsaError> {
        Ok(serde_json::from_str(data)?)
    }

    /// Serializa o documento como JSON (2 espaços de indentação).
    pub fn to_json_string(&self) -> Result<String, ProsaError> {
        Ok(serde_json::to_string_pretty(self)?)
    }

    /// Serializa e grava o documento em disco.
    pub fn save(&self, path: &Path) -> Result<(), ProsaError> {
        let data = self.to_json_string()?;
        std::fs::write(path, data)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Amostra representativa de um `.prosa` real: parágrafo com marks,
    /// título, metadados, notas e cabeçalho/rodapé.
    const SAMPLE: &str = r#"{
        "version": 1,
        "content": {
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": { "level": 1 },
                    "content": [{ "type": "text", "text": "Título" }]
                },
                {
                    "type": "paragraph",
                    "content": [
                        { "type": "text", "text": "Olá " },
                        {
                            "type": "text",
                            "text": "mundo",
                            "marks": [{ "type": "bold" }]
                        }
                    ]
                }
            ]
        },
        "metadata": {
            "title": "Documento de teste",
            "author": "Rodrigo Brito",
            "createdAt": "2026-07-18T10:00:00.000Z",
            "modifiedAt": "2026-07-18T10:05:00.000Z"
        },
        "notes": {
            "n1": { "id": "n1", "kind": "footnote", "text": "Nota de rodapé." }
        },
        "header": "<p>Cabeçalho</p>",
        "footer": "<p>Rodapé</p>"
    }"#;

    #[test]
    fn round_trip_preserves_structure() {
        let parsed = ProsaFile::from_str(SAMPLE).expect("deve interpretar o JSON de amostra");
        let serialized = parsed.to_json_string().expect("deve serializar de volta");
        let reparsed = ProsaFile::from_str(&serialized).expect("deve reinterpretar o JSON gerado");
        assert_eq!(parsed, reparsed);
    }

    #[test]
    fn parses_expected_fields() {
        let parsed = ProsaFile::from_str(SAMPLE).unwrap();
        assert_eq!(parsed.version, 1);
        assert_eq!(parsed.metadata.title, "Documento de teste");
        assert_eq!(parsed.header.as_deref(), Some("<p>Cabeçalho</p>"));
        assert_eq!(parsed.notes.unwrap().get("n1").unwrap().text, "Nota de rodapé.");
    }

    #[test]
    fn minimal_file_without_optional_fields() {
        let data = r#"{
            "version": 1,
            "content": { "type": "doc", "content": [{ "type": "paragraph" }] },
            "metadata": {
                "title": "Sem notas",
                "author": "",
                "createdAt": "2026-07-18T00:00:00.000Z",
                "modifiedAt": "2026-07-18T00:00:00.000Z"
            }
        }"#;
        let parsed = ProsaFile::from_str(data).expect("campos opcionais ausentes devem ser aceitos");
        assert!(parsed.notes.is_none());
        assert!(parsed.header.is_none());
    }

    #[test]
    fn new_document_has_single_empty_paragraph() {
        let file = ProsaFile::new("Sem título", "Rodrigo Brito", "2026-07-18T00:00:00.000Z");
        assert_eq!(file.content.kind, "doc");
        assert_eq!(file.content.content.as_ref().unwrap().len(), 1);
        assert_eq!(file.content.content.as_ref().unwrap()[0].kind, "paragraph");
    }

    #[test]
    fn plain_text_roundtrip_basic_paragraphs() {
        let doc = TipTapNode::doc_from_plain_text("linha 1\n\nlinha 3");
        assert_eq!(doc.plain_text(), "linha 1\n\nlinha 3");
    }

    #[test]
    fn plain_text_extracts_marked_text_from_sample() {
        let parsed = ProsaFile::from_str(SAMPLE).unwrap();
        assert_eq!(parsed.content.plain_text(), "Título\nOlá mundo");
    }
}
