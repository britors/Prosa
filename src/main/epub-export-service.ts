// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { exportEpub } from './epub.js'
import type { FileResult, SavePayload } from '../shared/types.js'

/** Exporta o documento atual para EPUB. */
export async function exportEpubDocument(
  window: BrowserWindow,
  defaultName: string,
  payload: SavePayload
): Promise<FileResult> {
  try {
    const result = await dialog.showSaveDialog(window, {
      title: 'Exportar EPUB',
      defaultPath: `${defaultName || 'documento'}.epub`,
      filters: [{ name: 'EPUB (.epub)', extensions: ['epub'] }]
    })
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true }
    }
    const buffer = await exportEpub(payload)
    await writeFile(result.filePath, buffer)
    return { ok: true, path: result.filePath }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
