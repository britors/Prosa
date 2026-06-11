// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import { join } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'

const pluginsPath = join(app.getPath('userData'), 'plugins')

export function getAvailablePlugins(): { id: string; name: string; content: string }[] {
  try {
    return readdirSync(pluginsPath)
      .filter((file) => file.endsWith('.js'))
      .map((file) => ({
        id: file,
        name: file.replace('.js', ''),
        content: readFileSync(join(pluginsPath, file), 'utf-8')
      }))
  } catch {
    return []
  }
}
