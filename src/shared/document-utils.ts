// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { NoteEntry, TipTapJSON } from './types.js'

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

/** Item do sumário com numeração hierárquica. */
export interface NumberedOutlineItem extends OutlineItem {
  number: string
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

/** Extrai chaves de citação encontradas em marcas `citation`. */
export function extractCitations(doc: TipTapJSON): string[] {
  const citations = new Set<string>()

  function walk(node: TipTapJSON): void {
    for (const mark of node.marks ?? []) {
      if (mark.type === 'citation') {
        const citeKey = mark.attrs?.citeKey
        if (typeof citeKey === 'string' && citeKey.trim()) {
          citations.add(citeKey.trim())
        }
      }
    }
    node.content?.forEach(walk)
  }

  walk(doc)
  return [...citations]
}

/** Extrai wikilinks `[[alvo]]` de um documento TipTap. */
export function extractWikilinks(doc: TipTapJSON): string[] {
  const links = new Set<string>()

  function walk(node: TipTapJSON): void {
    for (const mark of node.marks ?? []) {
      if (mark.type === 'wikilink') {
        const href = mark.attrs?.href
        if (typeof href === 'string' && href.startsWith('prosa://wiki/')) {
          links.add(decodeURIComponent(href.slice('prosa://wiki/'.length)))
        }
      }
    }
    node.content?.forEach(walk)
  }

  walk(doc)
  return [...links]
}

/** Extrai referências a notas do documento na ordem em que aparecem. */
export function extractNoteRefs(doc: TipTapJSON): { id: string; kind: NoteEntry['kind'] }[] {
  const refs: { id: string; kind: NoteEntry['kind'] }[] = []

  function walk(node: TipTapJSON): void {
    if (node.type === 'noteReference') {
      const id = String(node.attrs?.noteId ?? '').trim()
      const kind = node.attrs?.kind === 'endnote' ? 'endnote' : 'footnote'
      if (id) refs.push({ id, kind })
    }
    node.content?.forEach(walk)
  }

  walk(doc)
  return refs
}

/** Ordena e numera as notas de acordo com a ordem em que aparecem no texto. */
export function indexNotes(
  doc: TipTapJSON,
  notes: Record<string, NoteEntry>
): {
  footnotes: { id: string; number: number; text: string }[]
  endnotes: { id: string; number: number; text: string }[]
  numbers: Map<string, number>
} {
  const refs = extractNoteRefs(doc)
  const counters = { footnote: 0, endnote: 0 }
  const numbers = new Map<string, number>()
  const footnotes: { id: string; number: number; text: string }[] = []
  const endnotes: { id: string; number: number; text: string }[] = []

  for (const ref of refs) {
    const entry = notes[ref.id]
    if (!entry) continue
    counters[entry.kind] += 1
    numbers.set(ref.id, counters[entry.kind])
    const item = { id: ref.id, number: counters[entry.kind], text: entry.text }
    if (entry.kind === 'endnote') {
      endnotes.push(item)
    } else {
      footnotes.push(item)
    }
  }

  return { footnotes, endnotes, numbers }
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

/** Extrai os títulos com numeração hierárquica, útil para sumários. */
export function extractNumberedOutline(doc: TipTapJSON, maxLevel = 4): NumberedOutlineItem[] {
  const outline = extractOutline(doc, maxLevel)
  const counters = [0, 0, 0, 0, 0, 0]
  return outline.map((item) => {
    counters[item.level - 1] += 1
    for (let i = item.level; i < counters.length; i += 1) counters[i] = 0
    return {
      ...item,
      number: counters.slice(0, item.level).filter((n) => n > 0).join('.')
    }
  })
}
