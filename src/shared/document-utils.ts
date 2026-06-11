// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { TipTapJSON } from './types.js'

/** Velocidade média de leitura em palavras por minuto (pt-BR). */
const WORDS_PER_MINUTE = 200

/** Resultado da contagem de palavras e caracteres. */
export interface CountStats {
  words: number
  characters: number
  charactersNoSpaces: number
  readingTimeMinutes: number
}

/** Item da árvore de tópicos (outline) do documento. */
export interface OutlineItem {
  level: number
  text: string
  /** Índice do heading na ordem do documento (para navegação). */
  index: number
}

/** Conta as palavras de um texto, ignorando espaços extras. */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}

/** Conta os caracteres de um texto. */
export function countCharacters(text: string): number {
  return text.length
}

/** Conta os caracteres de um texto desconsiderando espaços em branco. */
export function countCharactersNoSpaces(text: string): number {
  return text.replace(/\s/g, '').length
}

/** Estima o tempo de leitura, em minutos, com base na contagem de palavras. */
export function estimateReadingTime(words: number): number {
  if (words === 0) return 0
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))
}

/** Calcula todas as estatísticas de contagem de uma só vez. */
export function computeStats(text: string): CountStats {
  const words = countWords(text)
  return {
    words,
    characters: countCharacters(text),
    charactersNoSpaces: countCharactersNoSpaces(text),
    readingTimeMinutes: estimateReadingTime(words)
  }
}

/** Extrai recursivamente todo o texto contido em um nó TipTap. */
export function extractText(node: TipTapJSON): string {
  if (node.type === 'text') {
    return node.text ?? ''
  }
  if (!node.content) {
    return ''
  }
  const parts = node.content.map(extractText)
  // Nós de bloco geram quebras de linha entre si.
  const blockTypes = new Set([
    'paragraph',
    'heading',
    'blockquote',
    'codeBlock',
    'listItem',
    'taskItem',
    'tableRow'
  ])
  const separator = blockTypes.has(node.type) ? '\n' : ''
  return parts.join('') + separator
}

/** Texto completo do documento, normalizado para contagem. */
export function documentText(doc: TipTapJSON): string {
  return extractText(doc).replace(/\n+/g, '\n').trim()
}

/**
 * Extrai a árvore de tópicos (headings H1–H4) do documento, na ordem em
 * que aparecem, para alimentar o painel de outline.
 */
export function extractOutline(doc: TipTapJSON, maxLevel = 4): OutlineItem[] {
  const outline: OutlineItem[] = []
  let index = 0

  function walk(node: TipTapJSON): void {
    if (node.type === 'heading') {
      const level = Number(node.attrs?.level ?? 1)
      if (level <= maxLevel) {
        outline.push({ level, text: extractText(node).trim(), index })
      }
      index += 1
    }
    node.content?.forEach(walk)
  }

  walk(doc)
  return outline
}
