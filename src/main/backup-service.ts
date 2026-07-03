// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { SavePayload } from '../shared/types.js'

/** Cria um backup automático do arquivo. */
export async function createBackup(path: string, payload: SavePayload, keepVersions = 20): Promise<void> {
  const backupDir = join(dirname(path), '.backups')
  await mkdir(backupDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/:/g, '-')
  const backupPath = join(backupDir, `${basename(path)}.${timestamp}.bak`)
  await writeFile(backupPath, JSON.stringify(payload), 'utf-8')

  const entries = await readdir(backupDir)
  const prefix = `${basename(path)}.`
  const backups = entries
    .filter((name) => name.startsWith(prefix) && name.endsWith('.bak'))
    .sort((a, b) => b.localeCompare(a))

  const stale = backups.slice(Math.max(1, keepVersions))
  await Promise.all(
    stale.map(async (name) => {
      try {
        await unlink(join(backupDir, name))
      } catch {
        // Ignore race conditions/permissions while pruning old backups.
      }
    })
  )
}
