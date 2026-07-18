//! Integração de IA assistida (revisar, resumir, expandir, traduzir, ...).
//!
//! Espelha `src/main/ai-service.ts` e `src/shared/ai-actions.ts` da versão
//! Electron: mesmos provedores, mesmos endpoints, mesmas ações de escrita
//! assistida com o mesmo texto de instrução em português. Sem streaming e
//! sem retry/backoff — uma única tentativa síncrona por chamada, igual ao
//! original.

mod actions;
mod credentials;
mod providers;

pub use actions::AiWritingAction;
pub use credentials::{ai_api_key_status, get_ai_api_key, remove_ai_api_key, set_ai_api_key, AiApiKeyStatus};

use std::fmt;

/// Provedores de IA suportados.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiProvider {
    OpenAi,
    Gemini,
    Anthropic,
    Mistral,
    Groq,
    Cohere,
}

impl AiProvider {
    pub const ALL: [AiProvider; 6] =
        [AiProvider::OpenAi, AiProvider::Gemini, AiProvider::Anthropic, AiProvider::Mistral, AiProvider::Groq, AiProvider::Cohere];

    pub fn as_str(&self) -> &'static str {
        match self {
            AiProvider::OpenAi => "openai",
            AiProvider::Gemini => "gemini",
            AiProvider::Anthropic => "anthropic",
            AiProvider::Mistral => "mistral",
            AiProvider::Groq => "groq",
            AiProvider::Cohere => "cohere",
        }
    }

    /// Cai para `openai` se a string não corresponder a nenhum provedor
    /// válido — mesmo comportamento de `normalizeAiProvider` no Electron.
    pub fn parse_or_default(value: &str) -> Self {
        match value {
            "gemini" => AiProvider::Gemini,
            "anthropic" => AiProvider::Anthropic,
            "mistral" => AiProvider::Mistral,
            "groq" => AiProvider::Groq,
            "cohere" => AiProvider::Cohere,
            _ => AiProvider::OpenAi,
        }
    }

    /// Modelo padrão: o primeiro da lista de opções na versão Electron.
    pub fn default_model(&self) -> &'static str {
        match self {
            AiProvider::OpenAi => "gpt-5.5",
            AiProvider::Gemini => "gemini-3.5-flash",
            AiProvider::Anthropic => "claude-fable-5",
            AiProvider::Mistral => "mistral-large-latest",
            AiProvider::Groq => "llama-3.3-70b-versatile",
            AiProvider::Cohere => "command-a-03-2025",
        }
    }
}

impl fmt::Display for AiProvider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Limite de entrada, igual ao `MAX_AI_INPUT_CHARS` do Electron.
pub const MAX_AI_INPUT_CHARS: usize = 20_000;

/// `maxOutputTokens` padrão quando o chamador não especifica um valor.
pub const DEFAULT_MAX_OUTPUT_TOKENS: u32 = 1200;

/// Pedido de uma ação de escrita assistida.
pub struct AiWritingRequest {
    pub action: AiWritingAction,
    pub text: String,
    pub instruction: Option<String>,
    pub target_language: Option<String>,
    pub tone: Option<String>,
}

/// Resultado normalizado de um provedor de IA.
#[derive(Debug, Clone)]
pub struct AiTextResult {
    pub provider: AiProvider,
    pub model: String,
    pub text: String,
}

/// Erros de geração de texto por IA, com as mesmas mensagens (em
/// português) que a versão Electron mostra ao usuário final.
#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error(
        "A IA ainda não está ativada. Abra as configurações de IA para escolher um provedor, informar a chave e ativar o recurso."
    )]
    Disabled,
    #[error("Informe uma instrução para a ação personalizada.")]
    MissingCustomInstruction,
    #[error("Informe um texto para a ação de IA.")]
    EmptyText,
    #[error("O texto é grande demais para a IA ({0} caracteres, o limite é {MAX_AI_INPUT_CHARS}).")]
    TextTooLong(usize),
    #[error("Falta configurar a chave de API do provedor {0}. Abra as configurações de IA para informá-la.")]
    MissingApiKey(AiProvider),
    #[error("Falha no provedor de IA ({status}): {message}")]
    Provider { status: u16, message: String },
    #[error("Não foi possível falar com o provedor de IA. Verifique sua conexão e tente novamente.")]
    Network(#[from] reqwest::Error),
    #[error("O provedor de IA não retornou texto.")]
    NoTextReturned,
    #[error("falha ao acessar o armazenamento seguro de credenciais: {0}")]
    Credentials(#[from] keyring::Error),
}

/// Monta a instrução final e chama o provedor. Não decide se a IA está
/// habilitada nem busca a chave de API — isso é responsabilidade de quem
/// chama (a UI conhece as configurações do usuário).
pub fn run_writing_action(
    provider: AiProvider,
    model: &str,
    api_key: &str,
    request: &AiWritingRequest,
    max_output_tokens: u32,
) -> Result<AiTextResult, AiError> {
    if request.text.trim().is_empty() {
        return Err(AiError::EmptyText);
    }
    if request.text.chars().count() > MAX_AI_INPUT_CHARS {
        return Err(AiError::TextTooLong(request.text.chars().count()));
    }
    let instruction = actions::build_instruction(request)?;
    let text = providers::call(provider, model, api_key, &instruction, request.text.trim(), max_output_tokens)?;
    if text.trim().is_empty() {
        return Err(AiError::NoTextReturned);
    }
    Ok(AiTextResult { provider, model: model.to_string(), text })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_round_trips_through_str() {
        for provider in AiProvider::ALL {
            assert_eq!(AiProvider::parse_or_default(provider.as_str()), provider);
        }
    }

    #[test]
    fn unknown_provider_falls_back_to_openai() {
        assert_eq!(AiProvider::parse_or_default("not-a-real-provider"), AiProvider::OpenAi);
    }

    #[test]
    fn empty_text_is_rejected_before_any_network_call() {
        let request = AiWritingRequest {
            action: AiWritingAction::Summarize,
            text: "   ".to_string(),
            instruction: None,
            target_language: None,
            tone: None,
        };
        let err = run_writing_action(AiProvider::OpenAi, "gpt-5.5", "fake-key", &request, DEFAULT_MAX_OUTPUT_TOKENS)
            .expect_err("texto vazio deve falhar antes de chamar a rede");
        assert!(matches!(err, AiError::EmptyText));
    }

    #[test]
    fn text_over_limit_is_rejected_before_any_network_call() {
        let request = AiWritingRequest {
            action: AiWritingAction::Summarize,
            text: "a".repeat(MAX_AI_INPUT_CHARS + 1),
            instruction: None,
            target_language: None,
            tone: None,
        };
        let err = run_writing_action(AiProvider::OpenAi, "gpt-5.5", "fake-key", &request, DEFAULT_MAX_OUTPUT_TOKENS)
            .expect_err("texto longo demais deve falhar antes de chamar a rede");
        assert!(matches!(err, AiError::TextTooLong(_)));
    }
}
