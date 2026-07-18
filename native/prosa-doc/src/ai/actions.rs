//! Ações de escrita assistida → instrução enviada ao provedor de IA.
//!
//! Espelha `src/shared/ai-actions.ts`: um mapeamento estático ação → texto
//! de instrução em português, com interpolação de tom/idioma/instrução
//! personalizada em algumas ações. Toda instrução final leva o mesmo sufixo
//! anti-comentário do original.

use super::{AiError, AiWritingRequest};

/// Ações de escrita assistida aceitas — mesmo conjunto de
/// `AiWritingAction` em `src/shared/types.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiWritingAction {
    Custom,
    Review,
    ImproveClarity,
    Summarize,
    GenerateAbstract,
    GenerateIntroduction,
    GenerateConclusion,
    ExtractKeywords,
    SuggestTitles,
    MainPoints,
    AnalyzeIssues,
    ReviewToneConsistency,
    StandardizeLanguage,
    FlagWeakPassages,
    SuggestArgumentExpansion,
    CheckVerbPersonConsistency,
    SuggestStructure,
    CompareOutline,
    SuggestSectionBreakdown,
    DetectLongSections,
    SuggestTransitions,
    ReorganizeIdeas,
    VerifyBibliography,
    FindMissingReferences,
    FindUnusedReferences,
    SuggestBibliographyStyleAdjustments,
    SummarizeUsedReferences,
    SuggestCitationNeededPlaces,
    TransformDraftToAcademicArticle,
    TransformToProfessionalReport,
    CreateShortAndLongVersions,
    GeneratePresentationOutline,
    CreateEditorialChecklist,
    Expand,
    Translate,
    ChangeTone,
}

const NO_COMMENTARY_SUFFIX: &str = "Responda apenas com o conteúdo pedido. Não inclua saudações, introduções como \"aqui está\" ou \"claro\", comentários avaliativos sobre o texto original (ex.: \"esse texto já está ótimo\") nem qualquer observação fora do que foi solicitado.";

/// Monta a instrução base de uma ação (sem o sufixo anti-comentário).
fn base_instruction(request: &AiWritingRequest) -> Result<String, AiError> {
    let tone = |default: &str| request.tone.clone().unwrap_or_else(|| default.to_string());
    let target_language = || request.target_language.clone().unwrap_or_else(|| "português do Brasil".to_string());

    Ok(match request.action {
        AiWritingAction::Custom => {
            let instruction = request.instruction.as_deref().unwrap_or("").trim();
            if instruction.is_empty() {
                return Err(AiError::MissingCustomInstruction);
            }
            instruction.to_string()
        }
        AiWritingAction::Review => {
            "Revise ortografia, gramática, pontuação e clareza do texto em português, preservando o sentido original.".to_string()
        }
        AiWritingAction::ImproveClarity => {
            "Melhore a clareza, fluidez e concisão do texto, preservando os fatos, a intenção original e o idioma.".to_string()
        }
        AiWritingAction::Summarize => "Resuma o texto com fidelidade, sem adicionar informação externa.".to_string(),
        AiWritingAction::GenerateAbstract => {
            "Gere um abstract acadêmico (ou resumo executivo) de um parágrafo a partir do texto.".to_string()
        }
        AiWritingAction::GenerateIntroduction => {
            "Gere uma introdução para o texto, contextualizando o tema e o objetivo, sem inventar fatos.".to_string()
        }
        AiWritingAction::GenerateConclusion => {
            "Gere uma conclusão coerente para o texto, retomando os pontos principais.".to_string()
        }
        AiWritingAction::ExtractKeywords => "Extraia de 5 a 12 palavras-chave do texto, em uma lista separada por vírgulas.".to_string(),
        AiWritingAction::SuggestTitles => {
            "Sugira 5 títulos e 5 subtítulos para o texto, em duas seções: \"Títulos\" e \"Subtítulos\".".to_string()
        }
        AiWritingAction::MainPoints => {
            "Liste de 5 a 12 pontos principais do texto, agrupando repetições.".to_string()
        }
        AiWritingAction::AnalyzeIssues => {
            "Analise o texto em três seções: \"Repetições\", \"Lacunas\" e \"Possíveis contradições\".".to_string()
        }
        AiWritingAction::ReviewToneConsistency => {
            "Aponte variações de tom, registro ou voz no texto, numa lista com sugestões de ajuste.".to_string()
        }
        AiWritingAction::StandardizeLanguage => {
            format!("Padronize a linguagem do texto para um tom {}, retornando a versão revisada.", tone("formal"))
        }
        AiWritingAction::FlagWeakPassages => {
            "Liste passagens fracas do texto no formato trecho / problema / sugestão.".to_string()
        }
        AiWritingAction::SuggestArgumentExpansion => {
            "Aponte pontos específicos do texto onde a argumentação poderia ser expandida.".to_string()
        }
        AiWritingAction::CheckVerbPersonConsistency => {
            "Aponte inconsistências de pessoa verbal ou voz narrativa ao longo do texto.".to_string()
        }
        AiWritingAction::SuggestStructure => {
            "Proponha uma reorganização do texto em seções, justificando a proposta.".to_string()
        }
        AiWritingAction::CompareOutline => {
            "Compare o outline atual do texto com um outline ideal: pontos fortes, lacunas e uma proposta.".to_string()
        }
        AiWritingAction::SuggestSectionBreakdown => {
            "Sugira uma divisão do texto em capítulos, seções e subseções.".to_string()
        }
        AiWritingAction::DetectLongSections => {
            "Liste seções do texto que estão longas demais e sugira como quebrá-las.".to_string()
        }
        AiWritingAction::SuggestTransitions => {
            "Sugira transições e conectores entre as seções do texto.".to_string()
        }
        AiWritingAction::ReorganizeIdeas => {
            "Proponha uma nova sequência lógica para as ideias/seções do texto.".to_string()
        }
        AiWritingAction::VerifyBibliography => {
            "Compare as citações do texto com a bibliografia disponível, apontando divergências.".to_string()
        }
        AiWritingAction::FindMissingReferences => {
            "Liste citações do texto que não têm entrada correspondente na bibliografia.".to_string()
        }
        AiWritingAction::FindUnusedReferences => {
            "Liste entradas da bibliografia que não são citadas no texto.".to_string()
        }
        AiWritingAction::SuggestBibliographyStyleAdjustments => {
            format!("Sugira ajustes na bibliografia para seguir o estilo {}.", tone("ABNT"))
        }
        AiWritingAction::SummarizeUsedReferences => {
            "Resuma as referências usadas no texto (chave, autor, título, ano).".to_string()
        }
        AiWritingAction::SuggestCitationNeededPlaces => {
            "Aponte trechos do texto que precisam de citação, sem inventar fontes.".to_string()
        }
        AiWritingAction::TransformDraftToAcademicArticle => {
            "Transforme este rascunho em uma estrutura de artigo acadêmico.".to_string()
        }
        AiWritingAction::TransformToProfessionalReport => {
            "Transforme este texto em um relatório profissional estruturado.".to_string()
        }
        AiWritingAction::CreateShortAndLongVersions => {
            "Gere uma versão curta e uma versão longa do texto, rotulando cada uma.".to_string()
        }
        AiWritingAction::GeneratePresentationOutline => {
            "Gere um roteiro de apresentação (slides) a partir do texto: título e pontos-chave por slide.".to_string()
        }
        AiWritingAction::CreateEditorialChecklist => {
            "Crie um checklist editorial para revisar este texto antes de publicar/exportar.".to_string()
        }
        AiWritingAction::Expand => "Expanda o texto mantendo o tom original, sem inventar fatos.".to_string(),
        AiWritingAction::Translate => format!("Traduza o texto para {}.", target_language()),
        AiWritingAction::ChangeTone => format!("Reescreva o texto em um tom {}.", tone("formal")),
    })
}

/// Monta a instrução final (base + sufixo anti-comentário) para uma ação.
pub fn build_instruction(request: &AiWritingRequest) -> Result<String, AiError> {
    let base = base_instruction(request)?;
    Ok(format!("{base} {NO_COMMENTARY_SUFFIX}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(action: AiWritingAction) -> AiWritingRequest {
        AiWritingRequest { action, text: "texto de exemplo".to_string(), instruction: None, target_language: None, tone: None }
    }

    #[test]
    fn custom_action_uses_the_given_instruction() {
        let mut req = request(AiWritingAction::Custom);
        req.instruction = Some("faça algo específico".to_string());
        let instruction = build_instruction(&req).unwrap();
        assert!(instruction.starts_with("faça algo específico"));
    }

    #[test]
    fn custom_action_without_instruction_is_an_error() {
        let req = request(AiWritingAction::Custom);
        assert!(matches!(build_instruction(&req), Err(AiError::MissingCustomInstruction)));
    }

    #[test]
    fn translate_interpolates_target_language_with_default() {
        let req = request(AiWritingAction::Translate);
        assert!(build_instruction(&req).unwrap().contains("português do Brasil"));

        let mut req_with_lang = request(AiWritingAction::Translate);
        req_with_lang.target_language = Some("inglês".to_string());
        assert!(build_instruction(&req_with_lang).unwrap().contains("inglês"));
    }

    #[test]
    fn change_tone_interpolates_tone_with_default() {
        let req = request(AiWritingAction::ChangeTone);
        assert!(build_instruction(&req).unwrap().contains("formal"));

        let mut req_with_tone = request(AiWritingAction::ChangeTone);
        req_with_tone.tone = Some("descontraído".to_string());
        assert!(build_instruction(&req_with_tone).unwrap().contains("descontraído"));
    }

    #[test]
    fn every_action_produces_a_non_empty_instruction_with_the_suffix() {
        let actions = [
            AiWritingAction::Review,
            AiWritingAction::ImproveClarity,
            AiWritingAction::Summarize,
            AiWritingAction::GenerateAbstract,
            AiWritingAction::GenerateIntroduction,
            AiWritingAction::GenerateConclusion,
            AiWritingAction::ExtractKeywords,
            AiWritingAction::SuggestTitles,
            AiWritingAction::MainPoints,
            AiWritingAction::AnalyzeIssues,
            AiWritingAction::ReviewToneConsistency,
            AiWritingAction::StandardizeLanguage,
            AiWritingAction::FlagWeakPassages,
            AiWritingAction::SuggestArgumentExpansion,
            AiWritingAction::CheckVerbPersonConsistency,
            AiWritingAction::SuggestStructure,
            AiWritingAction::CompareOutline,
            AiWritingAction::SuggestSectionBreakdown,
            AiWritingAction::DetectLongSections,
            AiWritingAction::SuggestTransitions,
            AiWritingAction::ReorganizeIdeas,
            AiWritingAction::VerifyBibliography,
            AiWritingAction::FindMissingReferences,
            AiWritingAction::FindUnusedReferences,
            AiWritingAction::SuggestBibliographyStyleAdjustments,
            AiWritingAction::SummarizeUsedReferences,
            AiWritingAction::SuggestCitationNeededPlaces,
            AiWritingAction::TransformDraftToAcademicArticle,
            AiWritingAction::TransformToProfessionalReport,
            AiWritingAction::CreateShortAndLongVersions,
            AiWritingAction::GeneratePresentationOutline,
            AiWritingAction::CreateEditorialChecklist,
            AiWritingAction::Expand,
        ];
        for action in actions {
            let instruction = build_instruction(&request(action)).unwrap();
            assert!(!instruction.is_empty());
            assert!(instruction.ends_with(NO_COMMENTARY_SUFFIX));
        }
    }
}
