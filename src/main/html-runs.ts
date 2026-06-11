// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Conversor leve do HTML das bandas de cabeçalho/rodapé (geradas por um
 * `contenteditable`) em linhas de "runs" com formatação básica (negrito,
 * itálico, sublinhado). Usado pelas exportações .docx e .odt.
 */

/** Trecho de texto com formatação inline. */
export interface Run {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
}

/** Uma linha (parágrafo) do cabeçalho/rodapé. */
export interface Line {
  runs: Run[]
}

/** Entidades HTML nomeadas mais comuns. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

/** Decodifica entidades nomeadas e numéricas de um texto HTML. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[entity] ?? match
  })
}

/** Tags tratadas como blocos (geram quebra de linha). */
const BLOCK_TAGS = new Set([
  'div',
  'p',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'table',
  'tr',
  'blockquote'
])

/** Calcula o incremento de formatação de uma tag inline (e seu style). */
function inlineDelta(name: string, attrs: string): { b: number; i: number; u: number } {
  let b = name === 'b' || name === 'strong' ? 1 : 0
  let i = name === 'i' || name === 'em' ? 1 : 0
  let u = name === 'u' || name === 'ins' ? 1 : 0
  if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(attrs)) b = 1
  if (/font-style\s*:\s*italic/i.test(attrs)) i = 1
  if (/text-decoration[^;"']*underline/i.test(attrs)) u = 1
  return { b, i, u }
}

/**
 * Analisa o HTML de uma banda e devolve as linhas com seus runs. Linhas
 * compostas apenas por espaços são descartadas. HTML vazio → lista vazia.
 */
export function parseHeaderHtml(html: string): Line[] {
  if (!html || html.trim().length === 0) return []

  const lines: Line[] = []
  let current: Run[] = []
  const stack: { b: number; i: number; u: number }[] = []
  let bold = 0
  let italic = 0
  let underline = 0

  const flush = (): void => {
    lines.push({ runs: current })
    current = []
  }

  const token = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)/g
  let match: RegExpExecArray | null
  while ((match = token.exec(html)) !== null) {
    const [raw, name, attrs, textChunk] = match

    if (textChunk !== undefined) {
      const text = decodeEntities(textChunk)
      if (text.length > 0) {
        current.push({ text, bold: bold > 0, italic: italic > 0, underline: underline > 0 })
      }
      continue
    }
    if (!name) continue // comentário

    const tag = name.toLowerCase()
    const closing = raw.startsWith('</')
    const selfClosing = raw.endsWith('/>')

    if (tag === 'br') {
      flush()
      continue
    }
    if (BLOCK_TAGS.has(tag)) {
      if (current.length > 0) flush()
      continue
    }

    const delta = inlineDelta(tag, attrs ?? '')
    if (delta.b || delta.i || delta.u) {
      if (closing) {
        const top = stack.pop()
        if (top) {
          bold -= top.b
          italic -= top.i
          underline -= top.u
        }
      } else if (!selfClosing) {
        stack.push(delta)
        bold += delta.b
        italic += delta.i
        underline += delta.u
      }
    }
  }
  flush()

  return lines.filter((line) => line.runs.some((run) => run.text.trim().length > 0))
}
