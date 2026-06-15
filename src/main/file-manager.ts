// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { BrowserWindow, dialog } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { basename, extname, join, dirname } from 'node:path'
import {
  exportDocx,
  exportMarkdown,
  importDocx,
  importMarkdown,
  importPlainText
} from './converters.js'
import { exportOdt, importOdt } from './odt.js'
import { exportRtf, importRtf } from './rtf.js'
import { importDoc } from './doc.js'
import { addRecentFile, removeRecentFile } from './settings.js'
import type {
  FileFormat,
  FileResult,
  OpenedDocument,
  SavePayload
} from '../shared/types.js'

/** Filtros de diálogo para abertura de arquivos. */
const OPEN_FILTERS = [
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
const UNSUPPORTED_OFFICE = new Set([
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
function detectFormat(path: string): FileFormat {
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

  switch (format) {
    case 'prosa': {
      const raw = await readFile(path, 'utf-8')
      const parsed = JSON.parse(raw)
      // O arquivo nativo guarda também o HTML renderizado para abertura rápida.
      html = typeof parsed.html === 'string' ? parsed.html : ''
      header = typeof parsed.header === 'string' ? parsed.header : ''
      footer = typeof parsed.footer === 'string' ? parsed.footer : ''
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
      const md = await readFile(path, 'utf-8')
      html = importMarkdown(md)
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

  return { path, name: basename(path), format, html, header, footer }
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
  switch (format) {
    case 'prosa': {
      const file = {
        version: 1,
        content: payload.json,
        html: payload.html,
        metadata: payload.metadata,
        header: payload.header ?? '',
        footer: payload.footer ?? ''
      }
      await writeFile(path, JSON.stringify(file, null, 2), 'utf-8')
      break
    }
    case 'docx': {
      const buffer = await exportDocx(payload.json, {
        header: payload.header,
        footer: payload.footer
      })
      await writeFile(path, buffer)
      break
    }
    case 'odt': {
      const buffer = await exportOdt(payload.json, {
        header: payload.header,
        footer: payload.footer
      })
      await writeFile(path, buffer)
      break
    }
    case 'rtf': {
      await writeFile(path, exportRtf(payload.json), 'utf-8')
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
      await writeFile(path, exportMarkdown(payload.json), 'utf-8')
      break
    }
    default: {
      await writeFile(path, payload.text, 'utf-8')
      break
    }
  }
}

/** Rótulo e extensão de cada formato gravável. */
const SAVE_FORMATS: Record<string, { name: string; ext: string }> = {
  prosa: { name: 'Documento Prosa', ext: 'prosa' },
  docx: { name: 'Word (.docx)', ext: 'docx' },
  odt: { name: 'OpenDocument (.odt)', ext: 'odt' },
  rtf: { name: 'Rich Text (.rtf)', ext: 'rtf' },
  md: { name: 'Markdown', ext: 'md' },
  txt: { name: 'Texto', ext: 'txt' }
}

/** Ordem dos filtros quando nenhum formato específico foi escolhido. */
const SAVE_FILTERS = Object.values(SAVE_FORMATS).map((f) => ({
  name: f.name,
  extensions: [f.ext]
}))

/** Garante que o caminho termine com a extensão do formato escolhido. */
function ensureExtension(path: string, format: FileFormat): string {
  const ext = SAVE_FORMATS[format]?.ext
  if (!ext) return path
  return path.toLowerCase().endsWith(`.${ext}`) ? path : `${path}.${ext}`
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
    await createSnapshot(payload)
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

/** Cria um snapshot de versão local. */
export async function createSnapshot(payload: SavePayload): Promise<void> {
  if (!payload.path) return
  const snapshotDir = join(dirname(payload.path), 'snapshots')
  await mkdir(snapshotDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/:/g, '-')
  const snapshotPath = join(snapshotDir, `${basename(payload.path)}.${timestamp}.snapshot`)
  await writeFile(snapshotPath, JSON.stringify(payload), 'utf-8')
}

/** Exporta a janela atual para PDF via printToPDF. */
export async function exportPdf(
  window: BrowserWindow,
  defaultName: string
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
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.98, bottom: 0.98, left: 0.79, right: 0.79 }
    })
    await writeFile(result.filePath, data)
    return { ok: true, path: result.filePath }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
