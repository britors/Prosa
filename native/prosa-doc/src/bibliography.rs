//! Citações e bibliografia (BibTeX).
//!
//! Espelha `src/shared/bibliography.ts` (parsing/formatação) e o pedaço de
//! `src/main/workspace.ts` que persiste `.prosa-bibliography.json`
//! (`readBibliography`/`writeBibliography`/`importBibTeX`). O parser de
//! BibTeX é feito à mão via regex no original — mantido assim aqui de
//! propósito (mesmas limitações herdadas: sem suporte a `@string`, valores
//! numéricos sem `{}`/`""`, ou chaves aninhadas com escape) para que um
//! `.bib` que funciona na versão Electron se comporte igual aqui.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::TipTapNode;

const BIBLIOGRAPHY_FILE: &str = ".prosa-bibliography.json";

/// Estilo de formatação bibliográfica suportado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BibliographyStyle {
    #[serde(rename = "ABNT")]
    Abnt,
    #[serde(rename = "APA")]
    Apa,
    #[serde(rename = "IEEE")]
    Ieee,
}

/// Entrada bibliográfica importada de um bloco BibTeX.
///
/// Espelha `BibliographyEntry` em `src/shared/types.ts` — o autor é mantido
/// como string bruta no formato BibTeX ("Sobrenome, Nome and Sobrenome2,
/// Nome2"), só fatiada na hora de formatar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BibliographyEntry {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    pub author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editor: Option<String>,
    pub year: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub journal: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub booktitle: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub institution: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub school: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pages: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub raw: String,
}

/// Estado persistido da bibliografia de um workspace (`.prosa-bibliography.json`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceBibliographyState {
    pub style: BibliographyStyle,
    #[serde(rename = "importedAt")]
    pub imported_at: Option<String>,
    pub entries: Vec<BibliographyEntry>,
}

pub fn default_bibliography() -> WorkspaceBibliographyState {
    WorkspaceBibliographyState { style: BibliographyStyle::Abnt, imported_at: None, entries: Vec::new() }
}

fn regex_cell<'a>(cell: &'a OnceLock<Regex>, pattern: &str) -> &'a Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("regex de bibliografia válida"))
}

/// Converte uma coleção BibTeX (`.bib`) em entradas estruturadas.
///
/// Blocos malformados (sem cabeçalho `@tipo{chave,` reconhecível) são
/// silenciosamente ignorados — mesmo comportamento do original, sem relatar
/// erro de sintaxe ao usuário.
pub fn parse_bibtex(raw: &str) -> Vec<BibliographyEntry> {
    static BLOCK: OnceLock<Regex> = OnceLock::new();
    static HEADER: OnceLock<Regex> = OnceLock::new();
    static FIELD: OnceLock<Regex> = OnceLock::new();

    let block_re = regex_cell(&BLOCK, r"@[a-zA-Z]+\s*\{[\s\S]*?\n\}");
    let header_re = regex_cell(&HEADER, r"^@([a-zA-Z]+)\s*\{\s*([^,]+),");
    let field_re = regex_cell(&FIELD, r#"([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(?:\{([\s\S]*?)\}|"([^"]*)")\s*,?"#);

    let mut entries = Vec::new();
    for block_match in block_re.find_iter(raw) {
        let block = block_match.as_str();
        let Some(header) = header_re.captures(block) else { continue };
        let kind = header[1].trim().to_lowercase();
        let key = header[2].trim().to_string();

        let mut fields: HashMap<String, String> = HashMap::new();
        for field_match in field_re.captures_iter(block) {
            let name = field_match[1].to_lowercase();
            let value = field_match.get(2).or_else(|| field_match.get(3)).map(|m| m.as_str()).unwrap_or("").trim().to_string();
            fields.insert(name, value);
        }

        let get = |name: &str| fields.get(name).cloned();

        entries.push(BibliographyEntry {
            key: key.clone(),
            kind,
            title: get("title").unwrap_or_else(|| key.clone()),
            author: get("author").unwrap_or_default(),
            editor: get("editor"),
            year: get("year").unwrap_or_default(),
            journal: get("journal"),
            booktitle: get("booktitle"),
            publisher: get("publisher"),
            institution: get("institution"),
            school: get("school"),
            volume: get("volume"),
            number: get("number"),
            pages: get("pages"),
            doi: get("doi"),
            url: get("url"),
            raw: block.trim().to_string(),
        });
    }
    entries
}

fn non_empty(value: Option<&String>) -> Option<&str> {
    value.map(String::as_str).filter(|s| !s.is_empty())
}

fn format_author_list(author: &str, style: BibliographyStyle) -> String {
    static AND: OnceLock<Regex> = OnceLock::new();
    let and_re = regex_cell(&AND, r"(?i)\s+and\s+");

    let first = and_re.split(author).next().unwrap_or("").trim();
    if first.is_empty() {
        return String::new();
    }

    let parts: Vec<&str> = if first.contains(',') { first.split(',').map(str::trim).collect() } else { first.split_whitespace().collect() };
    if parts.is_empty() {
        return first.to_string();
    }

    let family = parts[0];
    let given = parts[1..].join(" ");
    let initials = given
        .split_whitespace()
        .filter(|part| !part.is_empty())
        .map(|part| {
            let first_char = part.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default();
            format!("{first_char}.")
        })
        .collect::<Vec<_>>()
        .join(" ");

    match style {
        BibliographyStyle::Abnt => {
            let family_upper = family.to_uppercase();
            if given.is_empty() { family_upper } else { format!("{family_upper}, {given}") }
        }
        BibliographyStyle::Apa => {
            let combined = format!("{family}, {initials}");
            let trimmed = combined.trim();
            trimmed.strip_suffix(',').unwrap_or(trimmed).to_string()
        }
        BibliographyStyle::Ieee => format!("{initials} {family}").trim().to_string(),
    }
}

fn format_source(entry: &BibliographyEntry) -> &str {
    non_empty(entry.journal.as_ref())
        .or_else(|| non_empty(entry.booktitle.as_ref()))
        .or_else(|| non_empty(entry.publisher.as_ref()))
        .or_else(|| non_empty(entry.institution.as_ref()))
        .or_else(|| non_empty(entry.school.as_ref()))
        .unwrap_or("")
}

fn format_location(entry: &BibliographyEntry) -> String {
    let parts: Vec<String> = [
        non_empty(entry.volume.as_ref()).map(str::to_string),
        non_empty(entry.number.as_ref()).map(|n| format!("n. {n}")),
        non_empty(entry.pages.as_ref()).map(|p| format!("p. {p}")),
    ]
    .into_iter()
    .flatten()
    .collect();
    parts.join(", ")
}

/// Formata uma entrada bibliográfica no estilo pedido. `index` só é usado
/// pelo IEEE (`[1] Autor, "Título"...`), igual ao original.
pub fn format_bibliography_entry(entry: &BibliographyEntry, style: BibliographyStyle, index: usize) -> String {
    let author = format_author_list(&entry.author, style);
    let title = if entry.title.is_empty() { entry.key.clone() } else { entry.title.clone() };
    let year = if entry.year.is_empty() { "s.d.".to_string() } else { entry.year.clone() };
    let source = format_source(entry);
    let location = format_location(entry);
    let doi = non_empty(entry.doi.as_ref()).map(|doi| {
        static DOI_PREFIX: OnceLock<Regex> = OnceLock::new();
        let prefix_re = regex_cell(&DOI_PREFIX, r"(?i)^https?://(dx\.)?doi\.org/");
        format!("https://doi.org/{}", prefix_re.replace(doi, ""))
    });
    let url = entry.url.clone().unwrap_or_default();
    let source_line = [source, &location].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", ");
    let access = doi.filter(|d| !d.is_empty()).unwrap_or(url);

    let mut out = String::new();
    match style {
        BibliographyStyle::Abnt => {
            if !author.is_empty() {
                out.push_str(&author);
                out.push_str(". ");
            }
            out.push_str(&title);
            out.push_str(". ");
            if !source_line.is_empty() {
                out.push_str(&source_line);
                out.push_str(". ");
            }
            out.push_str(&year);
            out.push('.');
            if !access.is_empty() {
                out.push_str(" Disponível em: ");
                out.push_str(&access);
                out.push('.');
            }
        }
        BibliographyStyle::Apa => {
            if !author.is_empty() {
                out.push_str(&author);
                out.push(' ');
            }
            out.push('(');
            out.push_str(&year);
            out.push_str("). ");
            out.push_str(&title);
            out.push('.');
            if !source_line.is_empty() {
                out.push(' ');
                out.push_str(&source_line);
                out.push('.');
            }
            if !access.is_empty() {
                out.push(' ');
                out.push_str(&access);
                out.push('.');
            }
        }
        BibliographyStyle::Ieee => {
            out.push('[');
            out.push_str(&index.to_string());
            out.push_str("] ");
            if !author.is_empty() {
                out.push_str(&author);
                out.push_str(", ");
            }
            out.push('"');
            out.push_str(&title);
            out.push('"');
            if !source_line.is_empty() {
                out.push_str(", ");
                out.push_str(&source_line);
            }
            if !access.is_empty() {
                out.push_str(", ");
                out.push_str(&access);
            }
            out.push_str(", ");
            out.push_str(&year);
            out.push('.');
        }
    }
    out
}

/// Extrai as `citeKey`s (únicas, na ordem em que aparecem) das marks
/// `citation` do documento.
pub fn extract_citations(doc: &TipTapNode) -> Vec<String> {
    let mut keys = Vec::new();

    fn walk(node: &TipTapNode, keys: &mut Vec<String>) {
        if let Some(marks) = &node.marks {
            for mark in marks {
                if mark.kind != "citation" {
                    continue;
                }
                let Some(key) = mark.attrs.as_ref().and_then(|attrs| attrs.get("citeKey")).and_then(|v| v.as_str()) else { continue };
                let key = key.trim();
                if !key.is_empty() && !keys.iter().any(|existing: &String| existing == key) {
                    keys.push(key.to_string());
                }
            }
        }
        if let Some(children) = &node.content {
            for child in children {
                walk(child, keys);
            }
        }
    }

    walk(doc, &mut keys);
    keys
}

/// Gera o texto formatado da bibliografia para uma lista de `citeKey`s
/// (únicas, mantendo a ordem recebida; chaves sem entrada correspondente na
/// biblioteca são ignoradas).
pub fn render_bibliography(keys: &[String], entries: &[BibliographyEntry], style: BibliographyStyle) -> Vec<String> {
    let by_key: HashMap<&str, &BibliographyEntry> = entries.iter().map(|entry| (entry.key.as_str(), entry)).collect();
    let mut seen = std::collections::HashSet::new();
    keys.iter()
        .filter(|key| seen.insert(key.as_str()))
        .filter_map(|key| by_key.get(key.as_str()))
        .enumerate()
        .map(|(index, entry)| format_bibliography_entry(entry, style, index + 1))
        .collect()
}

/// Lê `.prosa-bibliography.json` da raiz do workspace; qualquer erro de
/// I/O ou de formato (arquivo ausente, JSON inválido, campos inesperados)
/// retorna o estado padrão silenciosamente, igual ao original.
pub fn read_bibliography(root: &Path) -> WorkspaceBibliographyState {
    let Ok(raw) = std::fs::read_to_string(root.join(BIBLIOGRAPHY_FILE)) else { return default_bibliography() };
    serde_json::from_str(&raw).unwrap_or_else(|_| default_bibliography())
}

/// Grava o estado da bibliografia em `.prosa-bibliography.json`.
pub fn write_bibliography(root: &Path, state: &WorkspaceBibliographyState) -> std::io::Result<()> {
    std::fs::create_dir_all(root)?;
    let json = serde_json::to_string_pretty(state).expect("WorkspaceBibliographyState sempre serializa");
    std::fs::write(root.join(BIBLIOGRAPHY_FILE), json)
}

/// Importa um `.bib`: casa por `key` com a biblioteca já persistida
/// (entradas novas sobrescrevem as existentes de mesma chave), reordena por
/// chave e grava. `now_iso` vem de fora (o crate não depende de nenhuma
/// lib de tempo) — mesmo padrão de `ProsaFile::new`.
pub fn import_bibtex(root: &Path, content: &str, now_iso: impl Into<String>) -> WorkspaceBibliographyState {
    let existing = read_bibliography(root);
    let parsed = parse_bibtex(content);

    let mut merged: BTreeMap<String, BibliographyEntry> = BTreeMap::new();
    for entry in existing.entries {
        merged.insert(entry.key.clone(), entry);
    }
    for entry in parsed {
        merged.insert(entry.key.clone(), entry);
    }

    let updated = WorkspaceBibliographyState { style: existing.style, imported_at: Some(now_iso.into()), entries: merged.into_values().collect() };
    let _ = write_bibliography(root, &updated);
    updated
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_entry() -> BibliographyEntry {
        BibliographyEntry {
            key: "silva2024".to_string(),
            kind: "article".to_string(),
            title: "Estudo do texto".to_string(),
            author: "Silva, Maria".to_string(),
            editor: None,
            year: "2024".to_string(),
            journal: Some("Revista Exemplo".to_string()),
            booktitle: None,
            publisher: None,
            institution: None,
            school: None,
            volume: Some("12".to_string()),
            number: Some("3".to_string()),
            pages: Some("10-18".to_string()),
            doi: Some("10.1234/exemplo".to_string()),
            url: None,
            raw: String::new(),
        }
    }

    #[test]
    fn parse_bibtex_extracts_basic_entry() {
        let entries = parse_bibtex(
            "\n@article{silva2024,\n  author = {Silva, Maria and Souza, Ana},\n  title = {Estudo do texto},\n  year = {2024},\n  journal = {Revista Exemplo},\n  volume = {12},\n  number = {3},\n  pages = {10-18},\n  doi = {10.1234/exemplo}\n}\n  ",
        );

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].key, "silva2024");
        assert_eq!(entries[0].title, "Estudo do texto");
        assert_eq!(entries[0].author, "Silva, Maria and Souza, Ana");
        assert_eq!(entries[0].volume.as_deref(), Some("12"));
        assert_eq!(entries[0].number.as_deref(), Some("3"));
        assert_eq!(entries[0].pages.as_deref(), Some("10-18"));
        assert_eq!(entries[0].doi.as_deref(), Some("10.1234/exemplo"));
    }

    #[test]
    fn parse_bibtex_supports_quoted_values_and_multiple_blocks() {
        let entries = parse_bibtex(
            "@book{knuth1984,\n  title = \"The TeXbook\",\n  author = \"Knuth, Donald\",\n  year = \"1984\"\n}\n@misc{semano,\n  title = {Sem ano}\n}\n",
        );
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].title, "The TeXbook");
        assert_eq!(entries[0].kind, "book");
        assert_eq!(entries[1].title, "Sem ano");
        assert_eq!(entries[1].author, "", "campo ausente vira string vazia, não None");
        assert_eq!(entries[1].year, "");
    }

    #[test]
    fn parse_bibtex_ignores_blocks_without_recognizable_header() {
        // Fechamento `}` não está sozinho no início da linha -> não bate o
        // regex de bloco, então isso nem chega a ser tentado.
        let entries = parse_bibtex("@article{sem-key-nem-virgula}\n");
        assert!(entries.is_empty());
    }

    #[test]
    fn format_bibliography_entry_matches_reference_expectations() {
        let entry = sample_entry();

        let abnt = format_bibliography_entry(&entry, BibliographyStyle::Abnt, 1);
        let apa = format_bibliography_entry(&entry, BibliographyStyle::Apa, 1);
        let ieee = format_bibliography_entry(&entry, BibliographyStyle::Ieee, 1);

        assert!(abnt.contains("Estudo do texto"));
        assert!(abnt.contains("Revista Exemplo"));
        assert!(abnt.contains("Disponível em:"));
        assert!(apa.contains("(2024)"));
        assert!(ieee.contains("[1]"));
    }

    #[test]
    fn format_bibliography_entry_abnt_uppercases_family_name_only() {
        let entry = sample_entry();
        let abnt = format_bibliography_entry(&entry, BibliographyStyle::Abnt, 1);
        assert!(abnt.starts_with("SILVA, Maria."));
    }

    #[test]
    fn format_bibliography_entry_apa_uses_initials() {
        let entry = sample_entry();
        let apa = format_bibliography_entry(&entry, BibliographyStyle::Apa, 1);
        assert!(apa.starts_with("Silva, M. (2024)."));
    }

    #[test]
    fn format_bibliography_entry_ieee_uses_initials_before_family() {
        let entry = sample_entry();
        let ieee = format_bibliography_entry(&entry, BibliographyStyle::Ieee, 1);
        assert!(ieee.starts_with("[1] M. Silva, "));
    }

    #[test]
    fn format_bibliography_entry_only_uses_first_author() {
        let mut entry = sample_entry();
        entry.author = "Silva, Maria and Souza, Ana".to_string();
        let apa = format_bibliography_entry(&entry, BibliographyStyle::Apa, 1);
        assert!(!apa.contains("Souza"), "só o primeiro autor deve aparecer, igual ao original");
    }

    #[test]
    fn format_bibliography_entry_handles_missing_author_and_year() {
        let entry = BibliographyEntry {
            key: "anon".to_string(),
            kind: "misc".to_string(),
            title: "".to_string(),
            author: "".to_string(),
            editor: None,
            year: "".to_string(),
            journal: None,
            booktitle: None,
            publisher: None,
            institution: None,
            school: None,
            volume: None,
            number: None,
            pages: None,
            doi: None,
            url: None,
            raw: String::new(),
        };
        let abnt = format_bibliography_entry(&entry, BibliographyStyle::Abnt, 1);
        assert_eq!(abnt, "anon. s.d..", "sem título usa a chave, sem ano usa 's.d.'");
    }

    #[test]
    fn format_bibliography_entry_cleans_doi_prefix() {
        let mut entry = sample_entry();
        entry.doi = Some("https://dx.doi.org/10.1234/exemplo".to_string());
        let abnt = format_bibliography_entry(&entry, BibliographyStyle::Abnt, 1);
        assert!(abnt.contains("Disponível em: https://doi.org/10.1234/exemplo."));
    }

    #[test]
    fn extract_citations_walks_nested_content_and_dedupes() {
        let doc = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "paragraph".to_string(),
                content: Some(vec![
                    TipTapNode {
                        kind: "text".to_string(),
                        text: Some("(Silva, 2024)".to_string()),
                        marks: Some(vec![crate::Mark { kind: "citation".to_string(), attrs: Some(serde_json::json!({ "citeKey": "silva2024" })) }]),
                        ..Default::default()
                    },
                    TipTapNode {
                        kind: "text".to_string(),
                        text: Some(" e de novo ".to_string()),
                        ..Default::default()
                    },
                    TipTapNode {
                        kind: "text".to_string(),
                        text: Some("(Silva, 2024)".to_string()),
                        marks: Some(vec![crate::Mark { kind: "citation".to_string(), attrs: Some(serde_json::json!({ "citeKey": "silva2024" })) }]),
                        ..Default::default()
                    },
                ]),
                ..Default::default()
            }]),
            ..Default::default()
        };
        assert_eq!(extract_citations(&doc), vec!["silva2024".to_string()]);
    }

    #[test]
    fn render_bibliography_numbers_in_key_order_and_skips_unknown_keys() {
        let entries = vec![sample_entry(), BibliographyEntry { key: "outro".to_string(), title: "Outro título".to_string(), ..sample_entry() }];
        let rendered = render_bibliography(&["silva2024".to_string(), "fantasma".to_string(), "outro".to_string()], &entries, BibliographyStyle::Ieee);
        assert_eq!(rendered.len(), 2);
        assert!(rendered[0].starts_with("[1]"));
        assert!(rendered[1].starts_with("[2]"));
        assert!(rendered[1].contains("Outro título"));
    }

    #[test]
    fn read_bibliography_returns_default_when_file_missing() {
        let dir = std::env::temp_dir().join(format!("prosa-bib-missing-{}", std::process::id()));
        let state = read_bibliography(&dir);
        assert_eq!(state, default_bibliography());
    }

    #[test]
    fn write_then_read_bibliography_round_trips() {
        let dir = std::env::temp_dir().join(format!("prosa-bib-roundtrip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let state = WorkspaceBibliographyState { style: BibliographyStyle::Apa, imported_at: Some("2026-07-19T00:00:00.000Z".to_string()), entries: vec![sample_entry()] };
        write_bibliography(&dir, &state).unwrap();
        let read_back = read_bibliography(&dir);
        assert_eq!(read_back, state);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn import_bibtex_merges_by_key_and_sorts() {
        let dir = std::env::temp_dir().join(format!("prosa-bib-import-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        write_bibliography(&dir, &WorkspaceBibliographyState { style: BibliographyStyle::Ieee, imported_at: None, entries: vec![sample_entry()] }).unwrap();

        let new_content = "@misc{amaral2020,\n  title = {Antes na ordem alfabética}\n}\n@article{silva2024,\n  title = {Título atualizado},\n  author = {Silva, Maria},\n  year = {2024}\n}\n";
        let updated = import_bibtex(&dir, new_content, "2026-07-19T10:00:00.000Z");

        assert_eq!(updated.style, BibliographyStyle::Ieee, "importar não deve mudar o estilo já escolhido");
        assert_eq!(updated.imported_at.as_deref(), Some("2026-07-19T10:00:00.000Z"));
        assert_eq!(updated.entries.len(), 2, "mesma key (silva2024) deve sobrescrever, não duplicar");
        assert_eq!(updated.entries[0].key, "amaral2020", "ordenado por key");
        assert_eq!(updated.entries[1].title, "Título atualizado", "entrada nova sobrescreve a antiga de mesma key");

        let persisted = read_bibliography(&dir);
        assert_eq!(persisted, updated, "import deve persistir em disco");

        std::fs::remove_dir_all(&dir).ok();
    }
}
