// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BibliographyEntry, BibliographyStyle } from './types.js'

/** Converte uma coleção BibTeX em entradas estruturadas. */
export function parseBibTeX(raw: string): BibliographyEntry[] {
  const entries: BibliographyEntry[] = []
  const blocks = raw.match(/@[a-zA-Z]+\s*\{[\s\S]*?\n\}/g) ?? []

  for (const block of blocks) {
    const header = block.match(/^@([a-zA-Z]+)\s*\{\s*([^,]+),/)
    if (!header) continue
    const [, type, key] = header
    const fields = new Map<string, string>()
    const fieldRegex = /([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(\{([\s\S]*?)\}|"([^"]*)")\s*,?/g
    let fieldMatch: RegExpExecArray | null
    while ((fieldMatch = fieldRegex.exec(block))) {
      const name = fieldMatch[1].toLowerCase()
      const value = (fieldMatch[3] ?? fieldMatch[4] ?? '').trim()
      fields.set(name, value)
    }

    entries.push({
      key: key.trim(),
      type: type.trim().toLowerCase(),
      title: fields.get('title') ?? key.trim(),
      author: fields.get('author') ?? '',
      editor: fields.get('editor'),
      year: fields.get('year') ?? '',
      journal: fields.get('journal'),
      booktitle: fields.get('booktitle'),
      publisher: fields.get('publisher'),
      institution: fields.get('institution'),
      school: fields.get('school'),
      volume: fields.get('volume'),
      number: fields.get('number'),
      pages: fields.get('pages'),
      doi: fields.get('doi'),
      url: fields.get('url'),
      raw: block.trim()
    })
  }

  return entries
}

function formatAuthorList(author: string, style: BibliographyStyle): string {
  const first = author.split(/\s+and\s+/i)[0]?.trim() ?? ''
  if (!first) return ''

  const parts = first.includes(',') ? first.split(',').map((part) => part.trim()) : first.split(/\s+/)
  if (parts.length === 0) return first

  const family = parts[0] ?? ''
  const given = parts.slice(1).join(' ')
  const initials = given
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase()}.`)
    .join(' ')

  switch (style) {
    case 'ABNT':
      return `${family.toUpperCase()}${given ? `, ${given}` : ''}`
    case 'APA':
      return `${family}, ${initials}`.trim().replace(/,\s*$/, '')
    case 'IEEE':
      return `${initials} ${family}`.trim()
  }
}

function formatSource(entry: BibliographyEntry): string {
  return entry.journal || entry.booktitle || entry.publisher || entry.institution || entry.school || ''
}

function formatLocation(entry: BibliographyEntry): string {
  const parts = [entry.volume, entry.number ? `n. ${entry.number}` : '', entry.pages ? `p. ${entry.pages}` : '']
    .filter(Boolean)
  return parts.join(', ')
}

/** Formata uma entrada bibliográfica em um estilo simples. */
export function formatBibliographyEntry(
  entry: BibliographyEntry,
  style: BibliographyStyle,
  index = 1
): string {
  const author = formatAuthorList(entry.author, style)
  const title = entry.title || entry.key
  const year = entry.year || 's.d.'
  const source = formatSource(entry)
  const location = formatLocation(entry)
  const doi = entry.doi ? `https://doi.org/${entry.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}` : ''
  const url = entry.url || ''
  const sourceLine = [source, location].filter(Boolean).join(', ')
  const access = doi || url

  switch (style) {
    case 'ABNT':
      return `${author ? `${author}. ` : ''}${title}. ${sourceLine ? `${sourceLine}. ` : ''}${year}.${access ? ` Disponível em: ${access}.` : ''}`
    case 'APA':
      return `${author ? `${author} ` : ''}(${year}). ${title}.${sourceLine ? ` ${sourceLine}.` : ''}${access ? ` ${access}.` : ''}`
    case 'IEEE':
      return `[${index}] ${author ? `${author}, ` : ''}"${title}"${sourceLine ? `, ${sourceLine}` : ''}${access ? `, ${access}` : ''}, ${year}.`
  }
}
