// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, readdirSync, writeFile, mkdirSync, unlinkSync } from 'node:fs'

const templatesPath = join(app.getPath('userData'), 'templates')

/** Garante que o diretório de templates exista. */
function ensureTemplatesDir(): void {
  try {
    mkdirSync(templatesPath, { recursive: true })
  } catch {}
}

export function getAvailableTemplates(): { id: string; name: string }[] {
  ensureTemplatesDir()
  try {
    return readdirSync(templatesPath)
      .filter((file) => file.endsWith('.css'))
      .map((file) => ({ id: file, name: file.replace('.css', '') }))
  } catch {
    return []
  }
}

export function getTemplateContent(id: string): string {
  try {
    return readFileSync(join(templatesPath, id), 'utf-8')
  } catch {
    return ''
  }
}

export function saveTemplate(name: string, css: string): void {
  ensureTemplatesDir()
  const filename = name.endsWith('.css') ? name : `${name}.css`
  writeFile(join(templatesPath, filename), css, (err) => {
    if (err) console.error('Erro ao salvar template:', err)
  })
}

export function deleteTemplate(id: string): void {
  ensureTemplatesDir()
  try {
    unlinkSync(join(templatesPath, id))
  } catch (err) {
    console.error('Erro ao excluir template:', err)
  }
}
