// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { BackupVersion } from '../shared/types.js'

/** Lista as versões de backup disponíveis para um documento, mais recente primeiro. */
export async function listVersions(path: string): Promise<BackupVersion[]> {
  const backupDir = join(dirname(path), '.backups')
  const prefix = `${basename(path)}.`

  let entries: string[]
  try {
    entries = (await readdir(backupDir)).filter((name) => name.startsWith(prefix) && name.endsWith('.bak'))
  } catch {
    return []
  }

  const versions = await Promise.all(
    entries.map(async (file) => {
      try {
        const info = await stat(join(backupDir, file))
        return { file, modifiedAt: info.mtime.toISOString() }
      } catch {
        return null
      }
    })
  )

  return versions
    .filter((v): v is BackupVersion => v !== null)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

/** Lê o texto puro salvo numa versão de backup específica. */
export async function getVersionText(path: string, file: string): Promise<string> {
  const prefix = `${basename(path)}.`
  const isSafeName = !file.includes('/') && !file.includes('..') && file.startsWith(prefix) && file.endsWith('.bak')
  if (!isSafeName) {
    throw new Error('Versão de backup inválida.')
  }

  const backupDir = join(dirname(path), '.backups')
  const raw = await readFile(join(backupDir, file), 'utf-8')
  const parsed: unknown = JSON.parse(raw)
  const text = typeof parsed === 'object' && parsed !== null ? (parsed as { text?: unknown }).text : undefined
  return typeof text === 'string' ? text : ''
}
