// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { extname } from 'node:path'
import type { FileFormat } from '../shared/types.js'

/** Filtros de diálogo para abertura de arquivos. */
export const OPEN_FILTERS = [
  {
    name: 'Todos os documentos',
    extensions: ['prosa', 'docx', 'odt', 'rtf', 'doc', 'md', 'markdown', 'txt']
  },
  { name: 'Documento Prosa', extensions: ['prosa'] },
  { name: 'Word (.docx)', extensions: ['docx'] },
  { name: 'OpenDocument (.odt)', extensions: ['odt'] },
  { name: 'Rich Text (.rtf)', extensions: ['rtf'] },
  { name: 'Word 97-2003 (.doc)', extensions: ['doc'] },
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: 'Texto', extensions: ['txt'] }
]

/** Extensões de formatos OpenDocument/Office que não são documentos de texto. */
export const UNSUPPORTED_OFFICE = new Set([
  'ods',
  'odp',
  'odg',
  'odf',
  'xls',
  'xlsx',
  'ppt',
  'pptx'
])

/** Detecta o formato a partir da extensão do arquivo. */
export function detectFormat(path: string): FileFormat {
  const ext = extname(path).toLowerCase().replace('.', '')
  switch (ext) {
    case 'prosa':
      return 'prosa'
    case 'docx':
      return 'docx'
    case 'odt':
      return 'odt'
    case 'rtf':
      return 'rtf'
    case 'doc':
      return 'doc'
    case 'md':
    case 'markdown':
      return 'md'
    default:
      return 'txt'
  }
}

/** Rótulo e extensão de cada formato gravável. */
export const SAVE_FORMATS: Record<string, { name: string; ext: string }> = {
  prosa: { name: 'Documento Prosa', ext: 'prosa' },
  docx: { name: 'Word (.docx)', ext: 'docx' },
  odt: { name: 'OpenDocument (.odt)', ext: 'odt' },
  rtf: { name: 'Rich Text (.rtf)', ext: 'rtf' },
  md: { name: 'Markdown', ext: 'md' },
  txt: { name: 'Texto', ext: 'txt' }
}

/** Ordem dos filtros quando nenhum formato específico foi escolhido. */
export const SAVE_FILTERS = Object.values(SAVE_FORMATS).map((f) => ({
  name: f.name,
  extensions: [f.ext]
}))

/** Garante que o caminho termine com a extensão do formato escolhido. */
export function ensureExtension(path: string, format: FileFormat): string {
  const ext = SAVE_FORMATS[format]?.ext
  if (!ext) return path
  return path.toLowerCase().endsWith(`.${ext}`) ? path : `${path}.${ext}`
}
