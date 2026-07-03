// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

const DELIMITER = /^---\r?\n/
const CLOSING_DELIMITER = /\r?\n---\r?\n/

/** Extrai um bloco de frontmatter (chave: valor por linha) do início de um markdown. */
export function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const openMatch = raw.match(DELIMITER)
  if (!openMatch) return { frontmatter: {}, body: raw }

  const afterOpen = raw.slice(openMatch[0].length)
  const closeMatch = afterOpen.match(CLOSING_DELIMITER)
  if (!closeMatch || closeMatch.index === undefined) return { frontmatter: {}, body: raw }

  const block = afterOpen.slice(0, closeMatch.index)
  const rest = afterOpen.slice(closeMatch.index + closeMatch[0].length)
  // Remove uma única quebra de linha em branco separando o bloco do corpo, se houver.
  const body = rest.replace(/^\r?\n/, '')

  const frontmatter: Record<string, string> = {}
  for (const line of block.split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!key) continue
    frontmatter[key] = value
  }

  return { frontmatter, body }
}

/** Reconstrói o bloco de frontmatter a partir dos pares chave/valor. Vazio → string vazia. */
export function serializeFrontmatter(frontmatter: Record<string, string> | undefined): string {
  const entries = Object.entries(frontmatter ?? {})
  if (entries.length === 0) return ''
  const lines = entries.map(([key, value]) => `${key}: ${value}`)
  return `---\n${lines.join('\n')}\n---\n\n`
}
