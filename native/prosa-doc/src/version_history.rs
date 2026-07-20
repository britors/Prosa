//! Histórico de versões: backups automáticos ao salvar, mais o diff entre
//! um snapshot antigo e o documento atual.
//!
//! Espelha `src/main/backup-service.ts` + `src/main/version-history.ts` do
//! Electron: cada salvamento bem-sucedido grava um snapshot numa pasta
//! `.backups` irmã do arquivo, nomeado `<basename>.<timestamp-iso>.bak`
//! (`:` viram `-` porque não são válidos em nomes de arquivo no Windows);
//! snapshots além de `keep_versions` são apagados, mais antigos primeiro.
//! Diferente do original — que gravava um `SavePayload` solto (html/json/
//! text redundantes) — cada `.bak` aqui guarda um `ProsaFile` completo, o
//! que permite restaurar (`read_version`), não só comparar. O Electron
//! nunca implementou restauração: o diálogo de comparação de versões lá era
//! só leitura.
//!
//! O diff (`diff_lines`) é por linha, como o `diffLines` do pacote `diff`
//! (jsdiff) usado no original, rodando sobre texto puro (`TipTapNode::
//! plain_text`), nunca sobre o JSON/HTML.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use similar::{ChangeTag, TextDiff};

use crate::ProsaFile;

const BACKUPS_DIR: &str = ".backups";
const BACKUP_SUFFIX: &str = ".bak";

/// Quantidade de versões mantidas por padrão (mesmo valor do Electron).
pub const DEFAULT_KEEP_VERSIONS: usize = 20;

/// Um snapshot listado (nome do arquivo + horário, reconstruído a partir do
/// próprio nome — não depende do `mtime` do arquivo no disco).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BackupVersion {
    pub file: String,
    #[serde(rename = "modifiedAt")]
    pub modified_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiffRowKind {
    Same,
    Added,
    Removed,
}

/// Uma linha do diff unificado: `Same`/`Removed` sempre trazem o texto da
/// linha antiga, `Added` o texto da linha nova (nunca as duas).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiffRow {
    pub text: String,
    pub kind: DiffRowKind,
}

fn backups_dir(path: &Path) -> PathBuf {
    path.parent().unwrap_or_else(|| Path::new(".")).join(BACKUPS_DIR)
}

fn backup_prefix(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

fn is_backup_of(name: &str, prefix: &str) -> bool {
    name.starts_with(&format!("{prefix}.")) && name.ends_with(BACKUP_SUFFIX)
}

/// Reconstrói o timestamp ISO original a partir do nome do arquivo (que tem
/// os `:` trocados por `-` pra ser um nome válido no Windows) — os dois
/// primeiros `-` depois do `T` são os separadores de hora/minuto/segundo, o
/// resto (a data, antes do `T`) já usa `-` de verdade.
fn timestamp_from_backup_name(name: &str, prefix: &str) -> Option<String> {
    let stripped = name.strip_prefix(&format!("{prefix}."))?.strip_suffix(BACKUP_SUFFIX)?;
    let t_pos = stripped.find('T')?;
    let (date_part, rest) = stripped.split_at(t_pos);
    let time_part = rest.strip_prefix('T')?;

    let mut fixed = String::with_capacity(time_part.len());
    let mut colons_written = 0;
    for c in time_part.chars() {
        if c == '-' && colons_written < 2 {
            fixed.push(':');
            colons_written += 1;
        } else {
            fixed.push(c);
        }
    }
    Some(format!("{date_part}T{fixed}"))
}

/// Grava um snapshot do documento em `.backups/` e apaga os mais antigos
/// além de `keep_versions` (mínimo 1, mesma regra do original).
pub fn create_backup(path: &Path, snapshot: &ProsaFile, keep_versions: usize, now_iso: impl Into<String>) -> std::io::Result<()> {
    let dir = backups_dir(path);
    std::fs::create_dir_all(&dir)?;

    let timestamp = now_iso.into().replace(':', "-");
    let prefix = backup_prefix(path);
    let file_name = format!("{prefix}.{timestamp}{BACKUP_SUFFIX}");
    let json = snapshot.to_json_string().map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
    std::fs::write(dir.join(&file_name), json)?;

    let mut backups: Vec<String> = std::fs::read_dir(&dir)?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| is_backup_of(name, &prefix))
        .collect();
    // Timestamp embutido no nome é lexicograficamente ordenável (ISO), então
    // ordenar pelo nome já ordena pelo horário sem precisar de `stat()`.
    backups.sort_by(|a, b| b.cmp(a));

    for stale in backups.into_iter().skip(keep_versions.max(1)) {
        let _ = std::fs::remove_file(dir.join(stale));
    }

    Ok(())
}

/// Lista os snapshots existentes de `path`, mais recente primeiro. Pasta
/// ausente ou vazia retorna lista vazia, sem erro.
pub fn list_versions(path: &Path) -> Vec<BackupVersion> {
    let dir = backups_dir(path);
    let prefix = backup_prefix(path);
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };

    let mut versions: Vec<BackupVersion> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            if !is_backup_of(&name, &prefix) {
                return None;
            }
            let modified_at = timestamp_from_backup_name(&name, &prefix)?;
            Some(BackupVersion { file: name, modified_at })
        })
        .collect();

    versions.sort_by(|a, b| b.file.cmp(&a.file));
    versions
}

/// Lê o `.prosa` completo de um snapshot. `file` precisa ser exatamente um
/// dos nomes retornados por `list_versions` (protege contra path traversal
/// vindo de qualquer entrada externa).
pub fn read_version(path: &Path, file: &str) -> Option<ProsaFile> {
    let prefix = backup_prefix(path);
    if !is_backup_of(file, &prefix) || file.contains('/') || file.contains('\\') {
        return None;
    }
    let raw = std::fs::read_to_string(backups_dir(path).join(file)).ok()?;
    ProsaFile::from_str(&raw).ok()
}

/// Diff por linha entre dois textos (não entre JSON/HTML) — `old_text` é o
/// lado "antes" (esquerda), `new_text` o "depois" (direita).
pub fn diff_lines(old_text: &str, new_text: &str) -> Vec<DiffRow> {
    TextDiff::from_lines(old_text, new_text)
        .iter_all_changes()
        .map(|change| {
            let text = change.value().trim_end_matches('\n').to_string();
            let kind = match change.tag() {
                ChangeTag::Equal => DiffRowKind::Same,
                ChangeTag::Delete => DiffRowKind::Removed,
                ChangeTag::Insert => DiffRowKind::Added,
            };
            DiffRow { text, kind }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DocumentMetadata, TipTapNode};

    fn sample_file(text: &str, modified_at: &str) -> ProsaFile {
        ProsaFile {
            version: 1,
            content: TipTapNode::doc_from_plain_text(text),
            metadata: DocumentMetadata {
                title: "Teste".to_string(),
                author: "Rodrigo".to_string(),
                created_at: "2026-07-19T00:00:00.000Z".to_string(),
                modified_at: modified_at.to_string(),
            },
            notes: None,
            header: None,
            footer: None,
            page_setup: None,
        }
    }

    fn temp_doc_path(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("prosa-version-history-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("documento.prosa")
    }

    #[test]
    fn list_versions_returns_empty_when_no_backups_dir() {
        let path = temp_doc_path("missing");
        assert!(list_versions(&path).is_empty());
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn create_backup_then_list_roundtrips_content() {
        let path = temp_doc_path("roundtrip");
        let snapshot = sample_file("linha 1", "2026-07-19T10:00:00.000Z");
        create_backup(&path, &snapshot, DEFAULT_KEEP_VERSIONS, "2026-07-19T10:00:00.000Z").unwrap();

        let versions = list_versions(&path);
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].modified_at, "2026-07-19T10:00:00.000Z");

        let read_back = read_version(&path, &versions[0].file).expect("deve ler o snapshot gravado");
        assert_eq!(read_back.content.plain_text(), "linha 1");

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn create_backup_prunes_beyond_keep_versions() {
        let path = temp_doc_path("prune");
        for i in 0..5 {
            let ts = format!("2026-07-19T10:0{i}:00.000Z");
            create_backup(&path, &sample_file(&format!("v{i}"), &ts), 3, ts).unwrap();
        }

        let versions = list_versions(&path);
        assert_eq!(versions.len(), 3, "deve manter só as 3 mais recentes");
        assert_eq!(versions[0].modified_at, "2026-07-19T10:04:00.000Z", "mais recente primeiro");
        assert_eq!(versions[2].modified_at, "2026-07-19T10:02:00.000Z");

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn read_version_rejects_unknown_or_unsafe_names() {
        let path = temp_doc_path("unsafe");
        create_backup(&path, &sample_file("x", "2026-07-19T10:00:00.000Z"), DEFAULT_KEEP_VERSIONS, "2026-07-19T10:00:00.000Z").unwrap();

        assert!(read_version(&path, "outro-arquivo.prosa.2026-07-19T10-00-00.000Z.bak").is_none());
        assert!(read_version(&path, "../../etc/passwd").is_none());
        assert!(read_version(&path, "documento.prosa.2026-07-19T10-00-00.000Z.bak/../evil").is_none());

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn diff_lines_marks_added_removed_and_unchanged() {
        let rows = diff_lines("a\nb\nc", "a\nx\nc");
        assert_eq!(
            rows,
            vec![
                DiffRow { text: "a".to_string(), kind: DiffRowKind::Same },
                DiffRow { text: "b".to_string(), kind: DiffRowKind::Removed },
                DiffRow { text: "x".to_string(), kind: DiffRowKind::Added },
                DiffRow { text: "c".to_string(), kind: DiffRowKind::Same },
            ]
        );
    }

    #[test]
    fn diff_lines_identical_texts_are_all_same() {
        let rows = diff_lines("igual", "igual");
        assert_eq!(rows, vec![DiffRow { text: "igual".to_string(), kind: DiffRowKind::Same }]);
    }
}
