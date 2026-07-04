// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { DocumentMetadata } from './types.js'
import type { TipTapJSON } from './types.js'

/** Variáveis documentais reconhecidas pelos elementos recorrentes. */
export type DocumentVariableName = 'title' | 'author' | 'date' | 'path' | 'page' | 'total'

/** Contexto necessário para resolver variáveis documentais. */
export interface DocumentVariableContext {
  metadata: DocumentMetadata
  currentPath: string | null
  page?: number
  total?: number
}

/** Marca textual usada pelo editor e pelos templates. */
export function documentVariableToken(name: DocumentVariableName): string {
  return `{{${name}}}`
}

function formatDate(iso?: string): string {
  const date = iso ? new Date(iso) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('pt-BR')
}

function currentPathLabel(path: string | null, fallbackTitle: string): string {
  if (!path) return fallbackTitle
  return path.split(/[\\/]/).pop() ?? fallbackTitle
}

/** Resolve variáveis documentais em uma string HTML/texto simples. */
export function resolveDocumentVariables(
  value: string,
  context: DocumentVariableContext,
  options: { preservePaginationTokens?: boolean } = {}
): string {
  return value.replace(/\{\{(title|author|date|path|page|total)\}\}/g, (_match, name: DocumentVariableName) => {
    switch (name) {
      case 'title':
        return context.metadata.title || 'Documento'
      case 'author':
        return context.metadata.author || ''
      case 'date':
        return formatDate(context.metadata.modifiedAt || context.metadata.createdAt)
      case 'path':
        return currentPathLabel(context.currentPath, context.metadata.title || 'Documento')
      case 'page':
        return options.preservePaginationTokens ? '{page}' : String(context.page ?? 1)
      case 'total':
        return options.preservePaginationTokens ? '{total}' : String(context.total ?? 1)
      default:
        return _match
    }
  })
}

/** Clona um documento TipTap substituindo variáveis documentais em nós de texto. */
export function resolveDocumentVariablesInTipTap(
  doc: TipTapJSON,
  context: DocumentVariableContext,
  options: { preservePaginationTokens?: boolean } = {}
): TipTapJSON {
  const walk = (node: TipTapJSON): TipTapJSON => {
    if (node.type === 'text') {
      return {
        ...node,
        text: resolveDocumentVariables(node.text ?? '', context, options)
      }
    }
    return {
      ...node,
      content: node.content?.map(walk)
    }
  }
  return walk(doc)
}
