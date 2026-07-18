//! Armazenamento de chaves de API via `keyring` (Secret Service/libsecret
//! no Linux) — mesma categoria de segurança que o `safeStorage` do
//! Electron (backend do chaveiro do sistema, nunca texto puro em disco).

use super::AiProvider;

const SERVICE_NAME: &str = "br.com.rodrigobrito.Prosa";

fn entry(provider: AiProvider) -> keyring::Result<keyring::Entry> {
    keyring::Entry::new(SERVICE_NAME, provider.as_str())
}

/// Estado da chave de um provedor, sem nunca expor o segredo em si —
/// espelha `AiApiKeyStatus` do Electron (sem o campo `encryptionAvailable`:
/// aqui a disponibilidade do chaveiro só aparece como erro na hora de usar,
/// não é verificada antecipadamente).
#[derive(Debug, Clone, Copy)]
pub struct AiApiKeyStatus {
    pub provider: AiProvider,
    pub configured: bool,
}

/// Busca a chave de API de um provedor, se houver.
pub fn get_ai_api_key(provider: AiProvider) -> keyring::Result<Option<String>> {
    match entry(provider)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err),
    }
}

/// Estado da chave de um provedor (configurada ou não).
pub fn ai_api_key_status(provider: AiProvider) -> AiApiKeyStatus {
    let configured = get_ai_api_key(provider).ok().flatten().is_some_and(|key| !key.is_empty());
    AiApiKeyStatus { provider, configured }
}

/// Grava a chave de API de um provedor no chaveiro do sistema.
pub fn set_ai_api_key(provider: AiProvider, api_key: &str) -> keyring::Result<()> {
    entry(provider)?.set_password(api_key)
}

/// Remove a chave de API de um provedor, se houver.
pub fn remove_ai_api_key(provider: AiProvider) -> keyring::Result<()> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err),
    }
}
