// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AiWritingAction, AiWritingRequest } from './types.js'

export const MAX_AI_INPUT_CHARS = 20_000

const ACTIONS: readonly AiWritingAction[] = [
  'custom',
  'review',
  'improveClarity',
  'summarize',
  'generateAbstract',
  'generateIntroduction',
  'generateConclusion',
  'extractKeywords',
  'suggestTitles',
  'mainPoints',
  'analyzeIssues',
  'reviewToneConsistency',
  'standardizeLanguage',
  'flagWeakPassages',
  'suggestArgumentExpansion',
  'checkVerbPersonConsistency',
  'suggestStructure',
  'compareOutline',
  'suggestSectionBreakdown',
  'detectLongSections',
  'suggestTransitions',
  'reorganizeIdeas',
  'verifyBibliography',
  'findMissingReferences',
  'findUnusedReferences',
  'suggestBibliographyStyleAdjustments',
  'summarizeUsedReferences',
  'suggestCitationNeededPlaces',
  'transformDraftToAcademicArticle',
  'transformToProfessionalReport',
  'createShortAndLongVersions',
  'generatePresentationOutline',
  'createEditorialChecklist',
  'expand',
  'translate',
  'changeTone'
]

export function isAiWritingAction(value: unknown): value is AiWritingAction {
  return typeof value === 'string' && ACTIONS.includes(value as AiWritingAction)
}

export function validateAiWritingRequest(value: unknown): AiWritingRequest {
  if (typeof value !== 'object' || value === null) throw new Error('Pedido de IA inválido.')
  const request = value as Record<string, unknown>
  if (!isAiWritingAction(request.action)) throw new Error('Ação de IA inválida.')
  if (typeof request.text !== 'string' || !request.text.trim()) throw new Error('Selecione ou informe um texto para a IA.')
  if (request.text.length > MAX_AI_INPUT_CHARS) {
    throw new Error(`O texto enviado à IA deve ter no máximo ${MAX_AI_INPUT_CHARS} caracteres.`)
  }

  return {
    action: request.action,
    text: request.text,
    instruction: typeof request.instruction === 'string' ? request.instruction : undefined,
    targetLanguage: typeof request.targetLanguage === 'string' ? request.targetLanguage : undefined,
    tone: typeof request.tone === 'string' ? request.tone : undefined
  }
}

const NO_COMMENTARY_SUFFIX =
  'Responda apenas com o conteúdo pedido. Não inclua saudações, introduções como "aqui está" ou "claro", comentários avaliativos sobre o texto original (ex.: "esse texto já está ótimo") nem qualquer observação fora do que foi solicitado.'

export function buildAiInstruction(request: AiWritingRequest): string {
  return `${buildBaseInstruction(request)} ${NO_COMMENTARY_SUFFIX}`
}

function buildBaseInstruction(request: AiWritingRequest): string {
  switch (request.action) {
    case 'review':
      return 'Revise ortografia, gramática, pontuação e clareza do texto em português. Preserve o sentido e retorne apenas a versão revisada.'
    case 'improveClarity':
      return 'Melhore a clareza, fluidez e concisão do texto. Preserve fatos, intenção e idioma. Retorne apenas a versão melhorada.'
    case 'summarize':
      return 'Resuma o texto com fidelidade, mantendo os pontos principais e sem adicionar informação externa.'
    case 'generateAbstract':
      return 'Gere um abstract acadêmico ou resumo executivo, conforme o tom do texto. Use um parágrafo claro, objetivo e fiel ao conteúdo, sem adicionar informação externa.'
    case 'generateIntroduction':
      return 'Gere uma introdução para o documento com base no conteúdo enviado. Apresente contexto, tema e objetivo de forma clara. Não invente fatos externos. Retorne apenas o texto da introdução.'
    case 'generateConclusion':
      return 'Gere uma conclusão coerente com o documento enviado. Retome os pontos principais e feche o raciocínio sem adicionar informação externa. Retorne apenas o texto da conclusão.'
    case 'extractKeywords':
      return 'Extraia de 5 a 12 palavras-chave do texto. Retorne apenas uma lista curta, separada por vírgulas, sem explicações e sem adicionar termos que não estejam apoiados no conteúdo.'
    case 'suggestTitles':
      return 'Sugira 5 títulos fortes e 5 subtítulos possíveis para o documento. Baseie-se apenas no conteúdo enviado. Retorne em duas seções curtas: "Títulos" e "Subtítulos".'
    case 'mainPoints':
      return 'Extraia os pontos principais do documento. Retorne uma lista objetiva com 5 a 12 itens, agrupando ideias repetidas e preservando a ordem lógica do texto. Não adicione informação externa.'
    case 'analyzeIssues':
      return 'Analise o documento e identifique repetições, lacunas e possíveis contradições internas. Retorne em três seções: "Repetições", "Lacunas" e "Possíveis contradições". Seja específico, cite o trecho ou ideia quando possível e diferencie achados claros de inferências da IA. Não reescreva o documento.'
    case 'reviewToneConsistency':
      return 'Revise o tom e a consistência de estilo do documento. Aponte variações de tom, mudanças bruscas de registro, inconsistências de voz, formalidade e vocabulário. Retorne achados objetivos em lista, com sugestões curtas de ajuste. Não reescreva o documento inteiro.'
    case 'standardizeLanguage':
      return `Padronize a linguagem do texto para um estilo ${request.tone?.trim() || 'formal'}. Preserve fatos, estrutura geral e sentido. Retorne uma versão revisada do texto, sem comentários extras.`
    case 'flagWeakPassages':
      return 'Aponte trechos vagos, fracos ou genéricos no documento. Retorne uma lista com: trecho/ideia, problema percebido e sugestão curta de melhoria. Não reescreva o documento inteiro.'
    case 'suggestArgumentExpansion':
      return 'Identifique onde a argumentação do documento poderia ser expandida. Retorne pontos específicos com o motivo da expansão e uma sugestão objetiva do que desenvolver. Não invente fatos externos.'
    case 'checkVerbPersonConsistency':
      return 'Verifique a consistência de pessoa verbal e voz narrativa do documento. Aponte mudanças inconsistentes entre primeira, segunda e terceira pessoa, além de alternâncias inadequadas de singular/plural. Retorne achados e sugestões curtas.'
    case 'suggestStructure':
      return 'Sugira uma estrutura melhor para o documento. Retorne uma proposta de organização em seções, com justificativa curta para cada mudança. Não reescreva o conteúdo.'
    case 'compareOutline':
      return 'Compare o outline atual informado com um outline ideal para o documento. Retorne: pontos fortes do outline atual, lacunas, títulos que deveriam mudar e uma proposta de outline revisado.'
    case 'suggestSectionBreakdown':
      return 'Sugira divisões de capítulos, seções e subseções para o documento. Identifique trechos que deveriam virar seções próprias e proponha nomes de seção. Não reescreva o texto.'
    case 'detectLongSections':
      return 'Identifique seções longas demais no documento. Retorne uma lista com a seção/trecho, por que parece longa demais e como quebrá-la em partes menores. Não reescreva o documento.'
    case 'suggestTransitions':
      return 'Sugira transições entre seções do documento. Use o texto e o outline atual para propor conectores curtos ou pequenos parágrafos de transição, sem reescrever o conteúdo inteiro.'
    case 'reorganizeIdeas':
      return 'Reorganize as ideias do documento em uma ordem mais lógica. Retorne uma proposta de sequência de seções/ideias e explique brevemente o motivo de cada ajuste. Não adicione fatos externos.'
    case 'verifyBibliography':
      return 'Compare as citações do texto com a bibliografia importada no workspace. Indique correspondências, divergências de chave/autor/ano e inconsistências de formatação. Retorne achados objetivos em seções curtas e não invente fontes.'
    case 'findMissingReferences':
      return 'Liste apenas as citações mencionadas no texto que não têm entrada bibliográfica correspondente. Retorne a chave ausente, onde aparece e uma observação curta. Não invente fontes.'
    case 'findUnusedReferences':
      return 'Liste as entradas bibliográficas importadas que não aparecem citadas no documento. Retorne chave, título e ano em uma lista objetiva. Não altere o documento.'
    case 'suggestBibliographyStyleAdjustments':
      return `Sugira ajustes para adequar a bibliografia ao estilo ${request.tone?.trim() || 'ABNT'}. Compare o formato das entradas com as convenções gerais do estilo escolhido e retorne recomendações práticas, sem inventar fontes.`
    case 'summarizeUsedReferences':
      return 'Resuma as referências efetivamente usadas no documento. Retorne chave, autor, título e ano das entradas citadas, em ordem de aparição, sem adicionar referências externas.'
    case 'suggestCitationNeededPlaces':
      return 'Aponte trechos ou afirmações do documento que parecem exigir citação. Não invente fontes nem cite obras específicas; apenas indique onde falta sustentação e que tipo de referência seria adequada.'
    case 'transformDraftToAcademicArticle':
      return 'Transforme o rascunho em uma estrutura de artigo acadêmico revisável. Retorne uma versão organizada com título, resumo, introdução, desenvolvimento, conclusão e indicação de lacunas que ainda precisam ser preenchidas. Não invente referências externas.'
    case 'transformToProfessionalReport':
      return 'Transforme o texto livre em um relatório profissional estruturado. Retorne uma versão com título, contexto, objetivo, análise, recomendações e conclusão, preservando os fatos e sem adicionar informação externa.'
    case 'createShortAndLongVersions':
      return 'Gere duas versões do texto: uma curta e uma longa. Rotule claramente cada uma, preserve o sentido original e não adicione informação externa.'
    case 'generatePresentationOutline':
      return 'Crie um roteiro ou estrutura de apresentação em slides a partir do documento. Retorne uma sequência de slides com título e pontos-chave por slide, sem inventar fatos externos.'
    case 'createEditorialChecklist':
      return 'Gere um checklist editorial antes da exportação do documento. Inclua itens práticos para revisar texto, estrutura, referências, títulos, padronização e formatação. Não altere o conteúdo do documento.'
    case 'expand':
      return 'Expanda o texto de forma coerente, mantendo o tom original e sem inventar fatos específicos.'
    case 'translate':
      return `Traduza o texto para ${request.targetLanguage?.trim() || 'português do Brasil'}. Preserve formatação textual simples e sentido.`
    case 'changeTone':
      return `Reescreva o texto em tom ${request.tone?.trim() || 'formal'}. Preserve fatos, idioma e intenção.`
    case 'custom': {
      const instruction = request.instruction?.trim()
      if (!instruction) throw new Error('Informe uma instrução para a ação personalizada.')
      return instruction
    }
  }
}
