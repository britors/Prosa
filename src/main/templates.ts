// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, readdirSync } from 'node:fs'

const templatesPath = join(app.getPath('userData'), 'templates')

export function getAvailableTemplates(): { id: string; name: string }[] {
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
