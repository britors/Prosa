// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { BrowserWindow, dialog } from 'electron'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { importDocx, importMarkdown, importPlainText } from './converters.js'
import { importOdt } from './odt.js'
import { importRtf } from './rtf.js'
import { importDoc } from './doc.js'
import { addRecentFile, removeRecentFile } from './settings.js'
import { detectFormat, OPEN_FILTERS, UNSUPPORTED_OFFICE } from './file-formats.js'
import { parseFrontmatter } from './frontmatter.js'
import type { FileResult, NoteEntry, OpenedDocument } from '../shared/types.js'

/** Lê e converte um arquivo do disco para HTML carregável no editor. */
export async function readDocument(path: string): Promise<OpenedDocument> {
  const ext = extname(path).toLowerCase().replace('.', '')
  if (UNSUPPORTED_OFFICE.has(ext)) {
    throw new Error(
      `O formato .${ext} não é um documento de texto e não pode ser aberto no Prosa. ` +
        'O Prosa é um processador de texto (Writer); para planilhas ou apresentações ' +
        'use o aplicativo correspondente da suíte.'
    )
  }

  const format = detectFormat(path)
  let html: string
  let header: string | undefined
  let footer: string | undefined
  let frontmatter: Record<string, string> | undefined
  let notes: Record<string, NoteEntry> | undefined

  switch (format) {
    case 'prosa': {
      const raw = await readFile(path, 'utf-8')
      const parsed = JSON.parse(raw)
      // O arquivo nativo guarda também o HTML renderizado para abertura rápida.
      html = typeof parsed.html === 'string' ? parsed.html : ''
      header = typeof parsed.header === 'string' ? parsed.header : ''
      footer = typeof parsed.footer === 'string' ? parsed.footer : ''
      frontmatter = typeof parsed.frontmatter === 'object' && parsed.frontmatter !== null ? parsed.frontmatter : {}
      notes = typeof parsed.notes === 'object' && parsed.notes !== null ? (parsed.notes as Record<string, NoteEntry>) : {}
      break
    }
    case 'docx': {
      const buffer = await readFile(path)
      html = await importDocx(buffer)
      break
    }
    case 'odt': {
      const buffer = await readFile(path)
      html = await importOdt(buffer)
      break
    }
    case 'rtf': {
      const rtf = await readFile(path, 'utf-8')
      html = importRtf(rtf)
      break
    }
    case 'doc': {
      const buffer = await readFile(path)
      html = importDoc(buffer)
      break
    }
    case 'md': {
      const raw = await readFile(path, 'utf-8')
      const parsed = parseFrontmatter(raw)
      html = importMarkdown(parsed.body)
      frontmatter = parsed.frontmatter
      break
    }
    default: {
      const text = await readFile(path, 'utf-8')
      html = importPlainText(text)
      break
    }
  }

  const recorded = addRecentFile({
    path,
    name: basename(path),
    modifiedAt: new Date().toISOString()
  })
  void recorded

  return { path, name: basename(path), format, html, header, footer, frontmatter, notes }
}

/** Abre um arquivo via diálogo (ou caminho direto, ex.: drag-and-drop). */
export async function openDocument(
  window: BrowserWindow,
  path?: string
): Promise<FileResult> {
  try {
    let target = path
    if (!target) {
      const result = await dialog.showOpenDialog(window, {
        title: 'Abrir documento',
        properties: ['openFile'],
        filters: OPEN_FILTERS
      })
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true }
      }
      target = result.filePaths[0]
    }
    const document = await readDocument(target)
    return { ok: true, document, path: target }
  } catch (error) {
    if (path) removeRecentFile(path)
    return { ok: false, error: (error as Error).message }
  }
}
