//! Verificação de atualização via GitHub Releases — mesma API já usada por
//! `scripts/install.sh` (sem token, respeitando o rate limit anônimo do
//! GitHub).
//!
//! Diferente do `electron-updater` da versão anterior (que baixava e
//! substituía os arquivos sozinho, algo que só faz sentido pra AppImage/NSIS),
//! aqui a checagem só informa se há uma versão mais nova — a instalação em si
//! fica a cargo do usuário, do mesmo jeito que ele já instalou (gerenciador
//! de pacotes no Linux, ou reextrair o `.zip` no Windows).

use serde::Deserialize;

const REPO: &str = "britors/Prosa";

/// Informação sobre uma atualização disponível.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateInfo {
    /// Versão da release mais nova, sem o prefixo `v` (ex.: `"6.0.0"`).
    pub version: String,
    /// Página da release no GitHub, para abrir no navegador.
    pub html_url: String,
}

#[derive(Deserialize)]
struct ReleaseResponse {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// Consulta a release mais recente do GitHub e retorna `Some` se ela for mais
/// nova que `current_version` (ambos no formato `MAJOR.MINOR.PATCH`, sem
/// prefixo `v`). Releases marcadas como rascunho ou pré-release são ignoradas.
pub fn check_for_update(current_version: &str) -> Result<Option<UpdateInfo>, String> {
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let client = reqwest::blocking::Client::builder()
        .user_agent(concat!("Prosa/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client.get(&url).send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("GitHub retornou {}", response.status()));
    }
    let release: ReleaseResponse = response.json().map_err(|err| err.to_string())?;
    if release.draft || release.prerelease {
        return Ok(None);
    }

    let latest = release.tag_name.trim_start_matches('v');
    if is_newer(latest, current_version) {
        Ok(Some(UpdateInfo { version: latest.to_string(), html_url: release.html_url }))
    } else {
        Ok(None)
    }
}

fn parse_version(version: &str) -> (u32, u32, u32) {
    let mut parts = version.split('.').map(|part| part.parse::<u32>().unwrap_or(0));
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}

fn is_newer(candidate: &str, current: &str) -> bool {
    parse_version(candidate) > parse_version(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_patch_version_is_detected() {
        assert!(is_newer("5.2.1", "5.2.0"));
    }

    #[test]
    fn newer_minor_and_major_versions_are_detected() {
        assert!(is_newer("5.3.0", "5.2.9"));
        assert!(is_newer("6.0.0", "5.2.0"));
    }

    #[test]
    fn equal_or_older_versions_are_not_newer() {
        assert!(!is_newer("5.2.0", "5.2.0"));
        assert!(!is_newer("5.1.9", "5.2.0"));
    }

    #[test]
    fn malformed_version_parts_fall_back_to_zero() {
        assert_eq!(parse_version("5.2"), (5, 2, 0));
        assert_eq!(parse_version("5"), (5, 0, 0));
        assert_eq!(parse_version("v5.2.0"), (0, 2, 0));
    }
}
