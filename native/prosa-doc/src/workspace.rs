//! Backlinks e grafo de wikilinks entre documentos de um workspace (pasta).
//!
//! Espelha o núcleo de `src/main/workspace.ts` (funções `normalizeKey`,
//! `normalizeLinkTarget`, `relationsFor`): varre todos os `.prosa` de uma
//! pasta, resolve os alvos das wikilinks de cada um contra os demais
//! documentos por chave normalizada (caminho, nome de arquivo ou título) e
//! monta a lista de backlinks. Ao contrário da versão Electron (que também
//! entende `.md`/`.txt` e calcula "relacionados" por tags/coleções/citações,
//! nenhuma das quais existe no modelo nativo ainda), aqui o escopo é só
//! `.prosa` + wikilinks — suficiente para a issue #160.
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::wikilink::extract_wikilinks;
use crate::ProsaFile;

/// Metadados de um documento do workspace relevantes para backlinks/grafo.
#[derive(Debug, Clone, PartialEq)]
pub struct DocumentSummary {
    pub path: PathBuf,
    pub title: String,
    pub links: Vec<String>,
}

/// Backlinks e links quebrados relativos a um documento-alvo.
#[derive(Debug, Clone, PartialEq)]
pub struct WorkspaceRelations {
    pub backlinks: Vec<DocumentSummary>,
    /// Alvos de wikilink, em todo o workspace, que não resolveram a nenhum documento.
    pub broken_links: Vec<String>,
}

/// Aresta do grafo de wikilinks: índices em `WorkspaceGraph::nodes`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GraphEdge {
    pub from: usize,
    pub to: usize,
}

pub struct WorkspaceGraph {
    pub nodes: Vec<DocumentSummary>,
    pub edges: Vec<GraphEdge>,
}

fn strip_diacritics(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' => 'a',
        'Á' | 'À' | 'Â' | 'Ã' | 'Ä' | 'Å' => 'A',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'É' | 'È' | 'Ê' | 'Ë' => 'E',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'Í' | 'Ì' | 'Î' | 'Ï' => 'I',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
        'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'O',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'Ú' | 'Ù' | 'Û' | 'Ü' => 'U',
        'ç' => 'c',
        'Ç' => 'C',
        'ñ' => 'n',
        'Ñ' => 'N',
        'ý' | 'ÿ' => 'y',
        'Ý' => 'Y',
        other => other,
    }
}

/// Chave de comparação estável para casar caminho/nome/título entre documentos.
///
/// Espelha `normalizeKey` de `workspace.ts`: remove acentos, minúsculas,
/// descarta a extensão final, colapsa barras e substitui qualquer outra
/// sequência de caracteres não alfanuméricos por um único hífen.
pub fn normalize_key(value: &str) -> String {
    let ascii_folded: String = value.chars().map(strip_diacritics).collect();
    let lower = ascii_folded.to_lowercase();
    let without_ext = match lower.rfind('.') {
        Some(idx) if idx + 1 < lower.len() => lower[..idx].to_string(),
        _ => lower,
    };

    let mut result = String::with_capacity(without_ext.len());
    for ch in without_ext.chars() {
        if ch == '/' || ch == '\\' {
            result.push('/');
        } else if ch.is_ascii_alphanumeric() {
            result.push(ch);
        } else if result.chars().last() != Some('-') {
            result.push('-');
        }
    }
    result.trim_matches('-').to_string()
}

/// Remove alias (`|`) e âncora (`#`) de um alvo de wikilink bruto.
///
/// Espelha `normalizeLinkTarget` de `workspace.ts`.
pub fn normalize_link_target(value: &str) -> String {
    let without_alias = value.split('|').next().unwrap_or(value);
    let without_anchor = without_alias.split('#').next().unwrap_or(without_alias);
    without_anchor.trim().to_string()
}

fn collect_prosa_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_hidden = entry.file_name().to_string_lossy().starts_with('.');
        if is_hidden {
            continue;
        }
        if path.is_dir() {
            collect_prosa_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("prosa")) {
            out.push(path);
        }
    }
}

/// Varre recursivamente `root` por arquivos `.prosa` (ignorando diretórios/arquivos
/// ocultos) e monta o resumo (título, wikilinks) de cada um.
pub fn scan_workspace(root: &Path) -> Vec<DocumentSummary> {
    let mut files = Vec::new();
    collect_prosa_files(root, &mut files);
    files.sort();

    files
        .into_iter()
        .filter_map(|path| {
            let file = ProsaFile::load(&path).ok()?;
            let title = if file.metadata.title.trim().is_empty() {
                path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
            } else {
                file.metadata.title.clone()
            };
            let links = extract_wikilinks(&file.content);
            Some(DocumentSummary { path, title, links })
        })
        .collect()
}

fn doc_keys(root: &Path, doc: &DocumentSummary) -> Vec<String> {
    let mut keys = vec![normalize_key(&doc.path.to_string_lossy())];
    if let Ok(rel) = doc.path.strip_prefix(root) {
        keys.push(normalize_key(&rel.to_string_lossy()));
    }
    if let Some(stem) = doc.path.file_stem() {
        keys.push(normalize_key(&stem.to_string_lossy()));
    }
    keys.push(normalize_key(&doc.title));
    keys
}

fn resolve_keys(root: &Path, docs: &[DocumentSummary]) -> HashMap<String, usize> {
    let mut map = HashMap::new();
    for (index, doc) in docs.iter().enumerate() {
        for key in doc_keys(root, doc) {
            map.insert(key, index);
        }
    }
    map
}

/// Calcula backlinks (documentos que referenciam `target_path`) e a lista de
/// links quebrados de todo o workspace (alvos que não resolveram a nenhum
/// documento), espelhando `relationsFor` de `workspace.ts`.
pub fn relations_for(root: &Path, target_path: &Path, docs: &[DocumentSummary]) -> WorkspaceRelations {
    let by_key = resolve_keys(root, docs);
    let target_keys: HashSet<String> =
        docs.iter().find(|doc| doc.path == target_path).map(|doc| doc_keys(root, doc).into_iter().collect()).unwrap_or_default();

    let mut backlinks = Vec::new();
    let mut broken = BTreeSet::new();

    for doc in docs {
        if doc.path == target_path {
            continue;
        }
        let mut matches_target = false;
        for link in &doc.links {
            let key = normalize_key(&normalize_link_target(link));
            let resolved = by_key.get(&key).map(|&index| &docs[index]);
            if resolved.is_some_and(|resolved_doc| resolved_doc.path == target_path) || target_keys.contains(&key) {
                matches_target = true;
            }
            if resolved.is_none() {
                broken.insert(link.clone());
            }
        }
        if matches_target {
            backlinks.push(doc.clone());
        }
    }

    backlinks.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));

    WorkspaceRelations { backlinks, broken_links: broken.into_iter().collect() }
}

/// Monta o grafo de conexões do workspace: um nó por documento, uma aresta
/// por wikilink que resolve a outro documento do mesmo workspace.
pub fn build_graph(root: &Path, docs: &[DocumentSummary]) -> WorkspaceGraph {
    let by_key = resolve_keys(root, docs);
    let mut edges = Vec::new();
    for (from, doc) in docs.iter().enumerate() {
        for link in &doc.links {
            let key = normalize_key(&normalize_link_target(link));
            if let Some(&to) = by_key.get(&key) {
                if to != from {
                    edges.push(GraphEdge { from, to });
                }
            }
        }
    }
    WorkspaceGraph { nodes: docs.to_vec(), edges }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wikilink::wiki_href;
    use crate::{DocumentMetadata, Mark, TipTapNode};

    fn write_doc(dir: &Path, filename: &str, title: &str, links: &[&str]) -> PathBuf {
        let mut content = vec![TipTapNode { kind: "text".to_string(), text: Some(title.to_string()), ..Default::default() }];
        for target in links {
            content.push(TipTapNode {
                kind: "text".to_string(),
                text: Some(format!(" {target} ")),
                marks: Some(vec![Mark { kind: "wikilink".to_string(), attrs: Some(serde_json::json!({ "href": wiki_href(target) })) }]),
                ..Default::default()
            });
        }
        let file = ProsaFile {
            version: 1,
            content: TipTapNode {
                kind: "doc".to_string(),
                content: Some(vec![TipTapNode { kind: "paragraph".to_string(), content: Some(content), ..Default::default() }]),
                ..Default::default()
            },
            metadata: DocumentMetadata {
                title: title.to_string(),
                author: "".to_string(),
                created_at: "2026-07-19T00:00:00.000Z".to_string(),
                modified_at: "2026-07-19T00:00:00.000Z".to_string(),
            },
            notes: None,
            header: None,
            footer: None,
            page_setup: None,
        };
        let path = dir.join(filename);
        file.save(&path).unwrap();
        path
    }

    #[test]
    fn scan_workspace_finds_prosa_files_and_extracts_links() {
        let dir = std::env::temp_dir().join(format!("prosa-workspace-scan-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();

        write_doc(&dir, "a.prosa", "Documento A", &["Documento B"]);
        write_doc(&dir.join("sub"), "b.prosa", "Documento B", &[]);
        std::fs::write(dir.join("nao-e-prosa.txt"), "ignorar").unwrap();

        let docs = scan_workspace(&dir);
        assert_eq!(docs.len(), 2, "deve achar os dois .prosa recursivamente, ignorando o .txt");
        let a = docs.iter().find(|d| d.title == "Documento A").unwrap();
        assert_eq!(a.links, vec!["Documento B".to_string()]);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn scan_workspace_ignores_hidden_directories() {
        let dir = std::env::temp_dir().join(format!("prosa-workspace-hidden-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".prosa-backup")).unwrap();
        write_doc(&dir.join(".prosa-backup"), "escondido.prosa", "Escondido", &[]);
        write_doc(&dir, "visivel.prosa", "Visível", &[]);

        let docs = scan_workspace(&dir);
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].title, "Visível");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn relations_for_finds_backlinks_by_title_and_reports_broken_links() {
        let dir = std::env::temp_dir().join(format!("prosa-workspace-relations-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();

        let target_path = write_doc(&dir, "alvo.prosa", "Documento Alvo", &[]);
        write_doc(&dir, "ref1.prosa", "Refere A", &["Documento Alvo"]);
        write_doc(&dir, "ref2.prosa", "Refere B", &["alvo", "Não Existe"]);
        write_doc(&dir, "solitario.prosa", "Sem Relação", &[]);

        let docs = scan_workspace(&dir);
        let relations = relations_for(&dir, &target_path, &docs);

        let backlink_titles: Vec<&str> = relations.backlinks.iter().map(|d| d.title.as_str()).collect();
        assert_eq!(backlink_titles, vec!["Refere A", "Refere B"], "ambos devem resolver, um por título e outro por nome de arquivo");
        assert_eq!(relations.broken_links, vec!["Não Existe".to_string()]);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn relations_for_document_without_backlinks_is_empty() {
        let dir = std::env::temp_dir().join(format!("prosa-workspace-no-backlinks-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target_path = write_doc(&dir, "sozinho.prosa", "Sozinho", &[]);
        write_doc(&dir, "outro.prosa", "Outro", &[]);

        let docs = scan_workspace(&dir);
        let relations = relations_for(&dir, &target_path, &docs);
        assert!(relations.backlinks.is_empty());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn build_graph_creates_edge_for_each_resolved_link() {
        let dir = std::env::temp_dir().join(format!("prosa-workspace-graph-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        write_doc(&dir, "a.prosa", "A", &["B"]);
        write_doc(&dir, "b.prosa", "B", &["A", "Fantasma"]);

        let docs = scan_workspace(&dir);
        let graph = build_graph(&dir, &docs);

        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.edges.len(), 2, "A->B e B->A resolvem; B->Fantasma não vira aresta");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn normalize_key_strips_accents_extension_and_punctuation() {
        assert_eq!(normalize_key("Capítulo Um.prosa"), "capitulo-um");
        assert_eq!(normalize_key("pasta/Sub Pasta/Nota.prosa"), "pasta/sub-pasta/nota");
    }

    #[test]
    fn normalize_link_target_strips_alias_and_anchor() {
        assert_eq!(normalize_link_target("Alvo|Texto Visível"), "Alvo");
        assert_eq!(normalize_link_target("Alvo#seção"), "Alvo");
        assert_eq!(normalize_link_target("  Alvo  "), "Alvo");
    }
}
