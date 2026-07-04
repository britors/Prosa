// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { FileResult, PdfPreset } from '../shared/types.js'

const PDF_PRESETS: Record<PdfPreset, {
  pageSize: 'A4' | 'Letter' | 'Legal'
  landscape: boolean
  printBackground: boolean
  margins: { top: number; bottom: number; left: number; right: number }
}> = {
  academic: {
    pageSize: 'A4',
    landscape: false,
    printBackground: true,
    margins: { top: 0.98, bottom: 0.98, left: 0.79, right: 0.79 }
  },
  report: {
    pageSize: 'Letter',
    landscape: false,
    printBackground: true,
    margins: { top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 }
  },
  contract: {
    pageSize: 'Legal',
    landscape: false,
    printBackground: false,
    margins: { top: 0.5, bottom: 0.5, left: 0.6, right: 0.6 }
  },
  book: {
    pageSize: 'A4',
    landscape: false,
    printBackground: true,
    margins: { top: 1.25, bottom: 1.25, left: 0.9, right: 0.9 }
  }
}

/** Resolve as opções de `printToPDF` a partir de um preset profissional. */
export function resolvePdfPrintOptions(
  preset?: PdfPreset,
  options?: {
    pageSize?: 'A4' | 'Letter' | 'Legal'
    landscape?: boolean
    printBackground?: boolean
  }
): {
  printBackground: boolean
  pageSize: 'A4' | 'Letter' | 'Legal'
  landscape: boolean
  margins: { top: number; bottom: number; left: number; right: number }
} {
  const presetOptions = preset ? PDF_PRESETS[preset] : null
  return {
    printBackground: presetOptions?.printBackground ?? options?.printBackground ?? true,
    pageSize: presetOptions?.pageSize ?? options?.pageSize ?? 'A4',
    landscape: presetOptions?.landscape ?? options?.landscape ?? false,
    margins: presetOptions?.margins ?? { top: 0.98, bottom: 0.98, left: 0.79, right: 0.79 }
  }
}

/** Exporta a janela atual para PDF via printToPDF. */
export async function exportPdf(
  window: BrowserWindow,
  defaultName: string,
  options?: {
    preset?: PdfPreset
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
    const data = await window.webContents.printToPDF(resolvePdfPrintOptions(options?.preset, options))
    await writeFile(result.filePath, data)
    return { ok: true, path: result.filePath }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
