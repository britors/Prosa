// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { exportDocx, exportMarkdown } from './converters.js'
import { exportEpub } from './epub.js'
import { exportOdt } from './odt.js'
import { exportRtf } from './rtf.js'
import { addRecentFile, getSettings } from './settings.js'
import { createBackup } from './backup-service.js'
import { ensureExtension, SAVE_FILTERS, SAVE_FORMATS, detectFormat } from './file-formats.js'
import { serializeFrontmatter } from './frontmatter.js'
import { resolveDocumentVariables, resolveDocumentVariablesInTipTap } from '../shared/document-variables.js'
import { documentText } from '../shared/document-utils.js'
import type { FileFormat, FileResult, SavePayload } from '../shared/types.js'

/**
 * Escreve o conteúdo no disco. Usa o formato explícito (escolhido pelo
 * usuário) quando informado; caso contrário, deduz pela extensão.
 */
async function writeDocument(
  path: string,
  payload: SavePayload,
  formatOverride?: FileFormat
): Promise<void> {
  const format = formatOverride ?? detectFormat(path)
  const variableContext = {
    metadata: payload.metadata,
    currentPath: payload.path
  }
  const resolvedJson = resolveDocumentVariablesInTipTap(payload.json, variableContext, { preservePaginationTokens: true })
  const resolvedHeader = resolveDocumentVariables(payload.header ?? '', variableContext, { preservePaginationTokens: true })
  const resolvedFooter = resolveDocumentVariables(payload.footer ?? '', variableContext, { preservePaginationTokens: true })
  switch (format) {
    case 'prosa': {
      const file = {
        version: 1,
        content: payload.json,
        html: payload.html,
        metadata: payload.metadata,
        notes: payload.notes ?? {},
        header: payload.header ?? '',
        footer: payload.footer ?? '',
        frontmatter: payload.frontmatter ?? {}
      }
      await writeFile(path, JSON.stringify(file, null, 2), 'utf-8')
      break
    }
    case 'docx': {
      const buffer = await exportDocx(resolvedJson, {
        header: resolvedHeader,
        footer: resolvedFooter
      }, payload.notes ?? {})
      await writeFile(path, buffer)
      break
    }
    case 'odt': {
      const buffer = await exportOdt(resolvedJson, {
        header: resolvedHeader,
        footer: resolvedFooter
      }, payload.notes ?? {})
      await writeFile(path, buffer)
      break
    }
    case 'rtf': {
      await writeFile(path, exportRtf(resolvedJson, payload.notes ?? {}), 'utf-8')
      break
    }
    case 'epub': {
      const buffer = await exportEpub({
        ...payload,
        json: resolvedJson,
        html: payload.html,
        text: documentText(resolvedJson),
        header: resolvedHeader,
        footer: resolvedFooter
      })
      await writeFile(path, buffer)
      break
    }
    case 'doc': {
      // O .doc binário (Word 97-2003) é apenas para leitura: não há gravação
      // confiável em JS puro. Orientamos a usar .docx ou .odt.
      throw new Error(
        'O formato .doc (Word 97-2003) é somente leitura no Prosa. ' +
          'Salve como .docx ou .odt para preservar a formatação.'
      )
    }
    case 'md': {
      await writeFile(path, serializeFrontmatter(payload.frontmatter) + exportMarkdown(resolvedJson, payload.notes ?? {}), 'utf-8')
      break
    }
    default: {
      await writeFile(path, documentText(resolvedJson), 'utf-8')
      break
    }
  }
}

/**
 * Salva o documento. Abre o diálogo de local quando ainda não há caminho ou
 * quando é "Salvar como". Se o renderer informou um formato explícito
 * (escolhido pelo usuário), o diálogo é restrito a ele e a extensão é
 * garantida; caso contrário, mostra todos os formatos disponíveis.
 */
export async function saveDocument(
  window: BrowserWindow,
  payload: SavePayload,
  forceDialog = false
): Promise<FileResult> {
  try {
    let target = payload.path
    const format = payload.format
    if (!target || forceDialog) {
      const filters =
        format && SAVE_FORMATS[format]
          ? [{ name: SAVE_FORMATS[format].name, extensions: [SAVE_FORMATS[format].ext] }]
          : SAVE_FILTERS
      const baseName = payload.metadata.title || 'Sem título'
      const defaultExt = format ? SAVE_FORMATS[format]?.ext ?? 'prosa' : 'prosa'
      const result = await dialog.showSaveDialog(window, {
        title: 'Salvar documento',
        defaultPath: target ?? `${baseName}.${defaultExt}`,
        filters
      })
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true }
      }
      target = format ? ensureExtension(result.filePath, format) : result.filePath
    }
    await writeDocument(target, payload, format)
    const settings = getSettings()
    if (settings.backupOnSave) {
      await createBackup(target, payload, settings.backupKeepVersions)
    }
    addRecentFile({
      path: target,
      name: basename(target),
      modifiedAt: new Date().toISOString()
    })
    return { ok: true, path: target }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
