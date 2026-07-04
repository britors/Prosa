// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { exportHtml } from './html-export.js'
import { resolveDocumentVariablesInTipTap } from '../shared/document-variables.js'
import { expandTableOfContents } from '../shared/table-of-contents.js'
import type { FileResult, HtmlExportOptions, NoteEntry, TipTapJSON } from '../shared/types.js'

/** Exporta o documento atual para HTML limpo. */
export async function exportHtmlDocument(
  window: BrowserWindow,
  defaultName: string,
  doc: TipTapJSON,
  options: HtmlExportOptions,
  notes: Record<string, NoteEntry> = {}
): Promise<FileResult> {
  try {
    const resolvedDoc = resolveDocumentVariablesInTipTap(doc, {
      metadata: { title: options.title ?? defaultName, author: '', createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString() },
      currentPath: null
    }, { preservePaginationTokens: true })
    const resolvedDocWithToc = expandTableOfContents(resolvedDoc)
    const result = await dialog.showSaveDialog(window, {
      title: 'Exportar HTML',
      defaultPath: `${defaultName || 'documento'}.html`,
      filters: [{ name: 'HTML', extensions: ['html', 'htm'] }]
    })
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true }
    }
    const html = exportHtml(resolvedDocWithToc, options, notes)
    await writeFile(result.filePath, html, 'utf-8')
    return { ok: true, path: result.filePath }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
