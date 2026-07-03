// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { FileResult } from '../shared/types.js'

/** Exporta a janela atual para PDF via printToPDF. */
export async function exportPdf(
  window: BrowserWindow,
  defaultName: string,
  options?: {
    pageSize?: 'A4' | 'Letter' | 'Legal'
    landscape?: boolean
    printBackground?: boolean
  }
): Promise<FileResult> {
  try {
    const result = await dialog.showSaveDialog(window, {
      title: 'Exportar PDF',
      defaultPath: `${defaultName || 'documento'}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true }
    }
    const data = await window.webContents.printToPDF({
      printBackground: options?.printBackground ?? true,
      pageSize: options?.pageSize ?? 'A4',
      landscape: options?.landscape ?? false,
      margins: { top: 0.98, bottom: 0.98, left: 0.79, right: 0.79 }
    })
    await writeFile(result.filePath, data)
    return { ok: true, path: result.filePath }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
