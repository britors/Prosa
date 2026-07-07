// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAiInstruction, MAX_AI_INPUT_CHARS, validateAiWritingRequest } from '../src/shared/ai-actions.ts'

test('valida apenas ações de IA conhecidas', () => {
  assert.throws(() => validateAiWritingRequest({ action: 'unknown', text: 'texto' }), /Ação de IA inválida/)
  assert.equal(validateAiWritingRequest({ action: 'review', text: 'texto' }).action, 'review')
})

test('bloqueia payload grande demais antes do provedor', () => {
  assert.throws(
    () => validateAiWritingRequest({ action: 'summarize', text: 'x'.repeat(MAX_AI_INPUT_CHARS + 1) }),
    /máximo/
  )
})

test('ação custom exige instrução explícita', () => {
  assert.throws(() => buildAiInstruction({ action: 'custom', text: 'texto' }), /instrução/)
  assert.match(buildAiInstruction({ action: 'custom', text: 'texto', instruction: 'Explique' }), /^Explique /)
})

test('todas as ações orientam a IA a responder sem comentários fora do conteúdo pedido', () => {
  assert.match(buildAiInstruction({ action: 'expand', text: 'texto' }), /comentários avaliativos/)
  assert.match(buildAiInstruction({ action: 'translate', text: 'texto', targetLanguage: 'inglês' }), /comentários avaliativos/)
  assert.match(buildAiInstruction({ action: 'changeTone', text: 'texto', tone: 'formal' }), /comentários avaliativos/)
})

test('ações com parâmetros montam instruções previsíveis', () => {
  assert.match(buildAiInstruction({ action: 'translate', text: 'Hello', targetLanguage: 'inglês' }), /inglês/)
  assert.match(buildAiInstruction({ action: 'changeTone', text: 'Oi', tone: 'profissional' }), /profissional/)
})

test('ação de palavras-chave orienta saída curta', () => {
  const instruction = buildAiInstruction({ action: 'extractKeywords', text: 'texto' })

  assert.match(instruction, /palavras-chave/)
  assert.match(instruction, /vírgulas/)
})

test('ação de título e subtítulos orienta saída estruturada', () => {
  const instruction = buildAiInstruction({ action: 'suggestTitles', text: 'texto' })

  assert.match(instruction, /títulos/)
  assert.match(instruction, /Subtítulos/)
})

test('ação de abstract orienta resumo executivo fiel ao documento', () => {
  const instruction = buildAiInstruction({ action: 'generateAbstract', text: 'texto' })

  assert.match(instruction, /abstract/)
  assert.match(instruction, /sem adicionar informação externa/)
})

test('ações de introdução e conclusão não devem inventar fatos externos', () => {
  assert.match(buildAiInstruction({ action: 'generateIntroduction', text: 'texto' }), /Não invente fatos externos/)
  assert.match(buildAiInstruction({ action: 'generateConclusion', text: 'texto' }), /sem adicionar informação externa/)
})

test('ação de pontos principais orienta lista objetiva', () => {
  const instruction = buildAiInstruction({ action: 'mainPoints', text: 'texto' })

  assert.match(instruction, /pontos principais/)
  assert.match(instruction, /5 a 12/)
})

test('ação de análise diferencia repetições, lacunas e contradições', () => {
  const instruction = buildAiInstruction({ action: 'analyzeIssues', text: 'texto' })

  assert.match(instruction, /Repetições/)
  assert.match(instruction, /Lacunas/)
  assert.match(instruction, /Possíveis contradições/)
  assert.match(instruction, /inferências da IA/)
})

test('ação de revisão de tom avalia consistência sem reescrever tudo', () => {
  const instruction = buildAiInstruction({ action: 'reviewToneConsistency', text: 'texto' })

  assert.match(instruction, /tom/)
  assert.match(instruction, /consistência de estilo/)
  assert.match(instruction, /Não reescreva/)
})

test('ação de padronização usa o tom escolhido', () => {
  const instruction = buildAiInstruction({ action: 'standardizeLanguage', text: 'texto', tone: 'acadêmico' })

  assert.match(instruction, /acadêmico/)
  assert.match(instruction, /versão revisada/)
})

test('ações de revisão profunda têm instruções editoriais específicas', () => {
  assert.match(buildAiInstruction({ action: 'flagWeakPassages', text: 'texto' }), /trechos vagos/)
  assert.match(buildAiInstruction({ action: 'suggestArgumentExpansion', text: 'texto' }), /argumentação/)
  assert.match(buildAiInstruction({ action: 'checkVerbPersonConsistency', text: 'texto' }), /pessoa verbal/)
})

test('ações de estrutura orientam outline e divisão de seções', () => {
  assert.match(buildAiInstruction({ action: 'suggestStructure', text: 'texto' }), /estrutura melhor/)
  assert.match(buildAiInstruction({ action: 'compareOutline', text: 'texto' }), /outline atual/)
  assert.match(buildAiInstruction({ action: 'suggestSectionBreakdown', text: 'texto' }), /capítulos/)
})

test('ações de estrutura avançada orientam análise de tamanho e transição', () => {
  assert.match(buildAiInstruction({ action: 'detectLongSections', text: 'texto' }), /seções longas/)
  assert.match(buildAiInstruction({ action: 'suggestTransitions', text: 'texto' }), /transições/)
  assert.match(buildAiInstruction({ action: 'reorganizeIdeas', text: 'texto' }), /ordem mais lógica/)
})

test('ações bibliográficas orientam análise de citações e referências', () => {
  assert.match(buildAiInstruction({ action: 'verifyBibliography', text: 'texto' }), /bibliografia importada/)
  assert.match(buildAiInstruction({ action: 'findMissingReferences', text: 'texto' }), /citações mencionadas/)
  assert.match(buildAiInstruction({ action: 'findUnusedReferences', text: 'texto' }), /não aparecem citadas/)
  assert.match(buildAiInstruction({ action: 'suggestBibliographyStyleAdjustments', text: 'texto', tone: 'APA' }), /APA/)
  assert.match(buildAiInstruction({ action: 'summarizeUsedReferences', text: 'texto' }), /referências efetivamente usadas/)
  assert.match(buildAiInstruction({ action: 'suggestCitationNeededPlaces', text: 'texto' }), /exigir citação/)
})

test('ações de saída orientam artigo, relatório, versões e checklist', () => {
  assert.match(buildAiInstruction({ action: 'transformDraftToAcademicArticle', text: 'texto' }), /artigo acadêmico/)
  assert.match(buildAiInstruction({ action: 'transformToProfessionalReport', text: 'texto' }), /relatório profissional/)
  assert.match(buildAiInstruction({ action: 'createShortAndLongVersions', text: 'texto' }), /curta e uma longa/)
  assert.match(buildAiInstruction({ action: 'generatePresentationOutline', text: 'texto' }), /apresentação/)
  assert.match(buildAiInstruction({ action: 'createEditorialChecklist', text: 'texto' }), /checklist editorial/)
})
