//! Chamadas HTTP a cada provedor de IA — mesmos endpoints, corpos e forma
//! de extrair o texto da resposta que `src/main/ai-service.ts` usa. Sem
//! streaming, sem retry: uma tentativa síncrona (bloqueante) por chamada.
//!
//! Cada provedor tem um formato de autenticação e de resposta diferente —
//! ver o comentário de cada função `call_*`. A extração é tolerante a
//! pequenas variações de formato (ex.: Mistral aceita `content` como string
//! ou como array de partes), igual ao original, pra não quebrar se a API
//! mudar sutilmente.

use serde_json::{json, Value};

use super::{AiError, AiProvider};

pub fn call(
    provider: AiProvider,
    model: &str,
    api_key: &str,
    instruction: &str,
    input: &str,
    max_output_tokens: u32,
) -> Result<String, AiError> {
    let client = reqwest::blocking::Client::new();
    match provider {
        AiProvider::OpenAi => call_openai(&client, model, api_key, instruction, input, max_output_tokens),
        AiProvider::Gemini => call_gemini(&client, model, api_key, instruction, input, max_output_tokens),
        AiProvider::Anthropic => call_anthropic(&client, model, api_key, instruction, input, max_output_tokens),
        AiProvider::Mistral => {
            call_chat_completions(&client, "https://api.mistral.ai/v1/chat/completions", model, api_key, instruction, input, max_output_tokens)
                .map(|body| extract_mistral_text(&body))
        }
        AiProvider::Groq => {
            call_chat_completions(&client, "https://api.groq.com/openai/v1/chat/completions", model, api_key, instruction, input, max_output_tokens)
                .map(|body| extract_groq_text(&body))
        }
        AiProvider::Cohere => call_cohere(&client, model, api_key, instruction, input, max_output_tokens),
    }
}

/// Lê o corpo da resposta como JSON de forma tolerante: se não for JSON
/// válido (ex. corpo de erro em texto puro), trata como `Value::Null` em
/// vez de propagar erro de parse — só o status importa nesse caso.
fn read_response(response: reqwest::blocking::Response) -> Result<(reqwest::StatusCode, Value), AiError> {
    let status = response.status();
    let text = response.text()?;
    let body: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    Ok((status, body))
}

fn assert_ok(status: reqwest::StatusCode, body: &Value) -> Result<(), AiError> {
    if status.is_success() {
        return Ok(());
    }
    let message = body
        .get("error")
        .map(|e| e.as_str().map(str::to_string).unwrap_or_else(|| e.to_string()))
        .unwrap_or_else(|| status.canonical_reason().unwrap_or("erro desconhecido").to_string());
    Err(AiError::Provider { status: status.as_u16(), message })
}

/// `POST https://api.openai.com/v1/responses` — API "Responses" da OpenAI
/// (não é o `chat/completions` clássico): `instructions`/`input` em vez de
/// mensagens, autenticação `Authorization: Bearer`.
fn call_openai(
    client: &reqwest::blocking::Client,
    model: &str,
    api_key: &str,
    instruction: &str,
    input: &str,
    max_output_tokens: u32,
) -> Result<String, AiError> {
    let body = json!({
        "model": model,
        "instructions": instruction,
        "input": input,
        "max_output_tokens": max_output_tokens,
    });
    let response = client.post("https://api.openai.com/v1/responses").bearer_auth(api_key).json(&body).send()?;
    let (status, body) = read_response(response)?;
    assert_ok(status, &body)?;
    Ok(extract_openai_text(&body))
}

fn extract_openai_text(body: &Value) -> String {
    if let Some(text) = body.get("output_text").and_then(Value::as_str) {
        return text.trim().to_string();
    }
    let mut parts = Vec::new();
    if let Some(output) = body.get("output").and_then(Value::as_array) {
        for item in output {
            if let Some(content) = item.get("content").and_then(Value::as_array) {
                for part in content {
                    if let Some(text) = part.get("text").and_then(Value::as_str) {
                        parts.push(text.to_string());
                    }
                }
            }
        }
    }
    parts.join("\n").trim().to_string()
}

/// `POST https://generativelanguage.googleapis.com/v1beta/{model}:generateContent`
/// — único provedor que autentica via query string (`?key=`), não header.
fn call_gemini(
    client: &reqwest::blocking::Client,
    model: &str,
    api_key: &str,
    instruction: &str,
    input: &str,
    max_output_tokens: u32,
) -> Result<String, AiError> {
    let model_path = if model.starts_with("models/") { model.to_string() } else { format!("models/{model}") };
    let url = format!("https://generativelanguage.googleapis.com/v1beta/{model_path}:generateContent");
    let body = json!({
        "system_instruction": { "parts": [{ "text": instruction }] },
        "contents": [{ "role": "user", "parts": [{ "text": input }] }],
        "generationConfig": { "maxOutputTokens": max_output_tokens },
    });
    let response = client.post(&url).query(&[("key", api_key)]).json(&body).send()?;
    let (status, body) = read_response(response)?;
    assert_ok(status, &body)?;
    Ok(extract_gemini_text(&body))
}

fn extract_gemini_text(body: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(candidates) = body.get("candidates").and_then(Value::as_array) {
        for candidate in candidates {
            if let Some(content_parts) = candidate.get("content").and_then(|c| c.get("parts")).and_then(Value::as_array) {
                for part in content_parts {
                    if let Some(text) = part.get("text").and_then(Value::as_str) {
                        parts.push(text.to_string());
                    }
                }
            }
        }
    }
    parts.join("\n").trim().to_string()
}

/// `POST https://api.anthropic.com/v1/messages` — autentica com `x-api-key`
/// (não `Bearer`) e exige o header `anthropic-version`.
fn call_anthropic(
    client: &reqwest::blocking::Client,
    model: &str,
    api_key: &str,
    instruction: &str,
    input: &str,
    max_output_tokens: u32,
) -> Result<String, AiError> {
    let body = json!({
        "model": model,
        "max_tokens": max_output_tokens,
        "system": instruction,
        "messages": [{ "role": "user", "content": input }],
    });
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()?;
    let (status, body) = read_response(response)?;
    assert_ok(status, &body)?;
    Ok(extract_anthropic_text(&body))
}

fn extract_anthropic_text(body: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(content) = body.get("content").and_then(Value::as_array) {
        for item in content {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                parts.push(text.to_string());
            }
        }
    }
    parts.join("\n").trim().to_string()
}

/// Corpo no formato "chat" (mensagens `system`/`user` + `max_tokens`),
/// compartilhado por Mistral e Groq (ambos compatíveis com o formato
/// `chat/completions` da OpenAI).
fn call_chat_completions(
    client: &reqwest::blocking::Client,
    url: &str,
    model: &str,
    api_key: &str,
    instruction: &str,
    input: &str,
    max_output_tokens: u32,
) -> Result<Value, AiError> {
    let body = json!({
        "model": model,
        "max_tokens": max_output_tokens,
        "messages": [
            { "role": "system", "content": instruction },
            { "role": "user", "content": input },
        ],
    });
    let response = client.post(url).bearer_auth(api_key).json(&body).send()?;
    let (status, body) = read_response(response)?;
    assert_ok(status, &body)?;
    Ok(body)
}

/// Mistral: `choices[0].message.content` pode ser string direta ou um
/// array de partes (`{ "text": "..." }` ou string bruta).
fn extract_mistral_text(body: &Value) -> String {
    let Some(content) = message_content(body) else { return String::new() };
    if let Some(text) = content.as_str() {
        return text.trim().to_string();
    }
    if let Some(parts) = content.as_array() {
        let joined: Vec<String> = parts
            .iter()
            .map(|part| {
                part.as_str().map(str::to_string).unwrap_or_else(|| {
                    part.get("text").and_then(Value::as_str).map(str::to_string).unwrap_or_default()
                })
            })
            .collect();
        return joined.join("\n").trim().to_string();
    }
    String::new()
}

/// Groq: `choices[0].message.content` só como string simples (mais
/// simples que o Mistral, não trata array).
fn extract_groq_text(body: &Value) -> String {
    message_content(body).and_then(Value::as_str).unwrap_or("").trim().to_string()
}

fn message_content(body: &Value) -> Option<&Value> {
    body.get("choices")?.get(0)?.get("message")?.get("content")
}

/// `POST https://api.cohere.com/v2/chat` — mesmo formato de mensagens que
/// Mistral/Groq, mas resposta em `message.content[]` (array de partes).
fn call_cohere(
    client: &reqwest::blocking::Client,
    model: &str,
    api_key: &str,
    instruction: &str,
    input: &str,
    max_output_tokens: u32,
) -> Result<String, AiError> {
    let body = json!({
        "model": model,
        "max_tokens": max_output_tokens,
        "messages": [
            { "role": "system", "content": instruction },
            { "role": "user", "content": input },
        ],
    });
    let response = client.post("https://api.cohere.com/v2/chat").bearer_auth(api_key).json(&body).send()?;
    let (status, body) = read_response(response)?;
    assert_ok(status, &body)?;
    Ok(extract_cohere_text(&body))
}

fn extract_cohere_text(body: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(content) = body.get("message").and_then(|m| m.get("content")).and_then(Value::as_array) {
        for item in content {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                parts.push(text.to_string());
            }
        }
    }
    parts.join("\n").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_openai_text_from_output_text_shortcut() {
        let body = json!({ "output_text": "  resposta pronta  " });
        assert_eq!(extract_openai_text(&body), "resposta pronta");
    }

    #[test]
    fn extracts_openai_text_from_output_array() {
        let body = json!({
            "output": [
                { "content": [{ "text": "parte 1" }] },
                { "content": [{ "text": "parte 2" }] }
            ]
        });
        assert_eq!(extract_openai_text(&body), "parte 1\nparte 2");
    }

    #[test]
    fn extracts_gemini_text_from_candidates() {
        let body = json!({
            "candidates": [
                { "content": { "parts": [{ "text": "olá" }, { "text": "mundo" }] } }
            ]
        });
        assert_eq!(extract_gemini_text(&body), "olá\nmundo");
    }

    #[test]
    fn extracts_anthropic_text_from_content_array() {
        let body = json!({ "content": [{ "type": "text", "text": "resposta claude" }] });
        assert_eq!(extract_anthropic_text(&body), "resposta claude");
    }

    #[test]
    fn extracts_mistral_text_from_plain_string_content() {
        let body = json!({ "choices": [{ "message": { "content": "  resposta mistral  " } }] });
        assert_eq!(extract_mistral_text(&body), "resposta mistral");
    }

    #[test]
    fn extracts_mistral_text_from_array_content() {
        let body = json!({ "choices": [{ "message": { "content": [{ "text": "parte a" }, "parte b"] } }] });
        assert_eq!(extract_mistral_text(&body), "parte a\nparte b");
    }

    #[test]
    fn extracts_groq_text_from_plain_string_content() {
        let body = json!({ "choices": [{ "message": { "content": "resposta groq" } }] });
        assert_eq!(extract_groq_text(&body), "resposta groq");
    }

    #[test]
    fn extracts_cohere_text_from_message_content_array() {
        let body = json!({ "message": { "content": [{ "type": "text", "text": "resposta cohere" }] } });
        assert_eq!(extract_cohere_text(&body), "resposta cohere");
    }

    #[test]
    fn assert_ok_extracts_provider_error_message() {
        let body = json!({ "error": { "message": "chave inválida" } });
        let err = assert_ok(reqwest::StatusCode::UNAUTHORIZED, &body).unwrap_err();
        match err {
            AiError::Provider { status, message } => {
                assert_eq!(status, 401);
                assert!(message.contains("chave inválida"));
            }
            other => panic!("esperava AiError::Provider, obteve {other:?}"),
        }
    }

    #[test]
    fn assert_ok_passes_through_success_status() {
        assert!(assert_ok(reqwest::StatusCode::OK, &Value::Null).is_ok());
    }
}
