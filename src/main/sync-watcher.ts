// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import chokidar, { type FSWatcher } from 'chokidar'
import { getSettings } from './settings.js'

let watcher: FSWatcher | null = null
const recentSelfWrites = new Set<string>()
/** Tempo, em ms, que um caminho gravado pelo próprio app fica suprimido de notificações. */
const SELF_WRITE_TTL_MS = 3000

/** Marca um caminho como recém-salvo pelo app, para não notificar sobre a própria escrita. */
export function markSelfWrite(path: string): void {
  recentSelfWrites.add(path)
  setTimeout(() => recentSelfWrites.delete(path), SELF_WRITE_TTL_MS)
}

/** Observa a pasta de sincronização configurada, notificando mudanças externas. */
export function setupSyncWatcher(onExternalChange: (path: string) => void): void {
  if (watcher) void watcher.close()
  watcher = null

  const settings = getSettings()
  if (!settings.syncPath) return

  watcher = chokidar.watch(settings.syncPath, {
    ignored: /(^|[/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 }
  })

  watcher.on('change', (path: string) => {
    if (recentSelfWrites.has(path)) return
    onExternalChange(path)
  })
}

/** Encerra o observador da pasta de sincronização. */
export function stopSyncWatcher(): void {
  if (watcher) void watcher.close()
  watcher = null
}
