// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import Store from 'electron-store'
import type { AutoSavePolicy, ProsaSettings, RecentFile } from '../shared/types.js'

/** Valores padrão das configurações do Prosa. */
const defaults: ProsaSettings = {
  theme: 'dark',
  fontSize: 12,
  fontFamily: 'Georgia',
  lineHeight: 1.6,
  spellcheck: true,
  spellLanguages: ['pt-BR', 'en-US'],
  autoSavePolicy: 'interval',
  autoSaveDebounceSeconds: 30,
  autoSaveIntervalMinutes: 5,
  showWordCount: true,
  showOutline: true,
  distractionFree: false,
  recentFiles: [],
  pinnedFiles: [],
  zoom: 100
}

const store = new Store<ProsaSettings>({ name: 'prosa-settings', defaults })

type StoredSettings = Partial<ProsaSettings> & {
  autoSave?: boolean
  autoSaveInterval?: number
}

const VALID_AUTOSAVE_POLICIES: readonly AutoSavePolicy[] = ['off', 'onBlur', 'debounce', 'interval']

function isAutoSavePolicy(value: unknown): value is AutoSavePolicy {
  return typeof value === 'string' && VALID_AUTOSAVE_POLICIES.includes(value as AutoSavePolicy)
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.round(value))
}

function normalizeSettings(raw: StoredSettings): ProsaSettings {
  let autoSavePolicy: AutoSavePolicy
  if (isAutoSavePolicy(raw.autoSavePolicy)) {
    autoSavePolicy = raw.autoSavePolicy
  } else if (raw.autoSave === false) {
    autoSavePolicy = 'off'
  } else if (raw.autoSave === true && typeof raw.autoSaveInterval === 'number') {
    autoSavePolicy = 'debounce'
  } else {
    autoSavePolicy = defaults.autoSavePolicy
  }

  const autoSaveDebounceSeconds = normalizePositiveInt(
    raw.autoSaveDebounceSeconds ?? raw.autoSaveInterval,
    defaults.autoSaveDebounceSeconds
  )
  const autoSaveIntervalMinutes = normalizePositiveInt(
    raw.autoSaveIntervalMinutes,
    defaults.autoSaveIntervalMinutes
  )

  return {
    ...defaults,
    ...raw,
    autoSavePolicy,
    autoSaveDebounceSeconds,
    autoSaveIntervalMinutes
  }
}

/** Retorna a lista de arquivos fixados. */
export function getPinnedFiles(): RecentFile[] {
  return store.get('pinnedFiles', [])
}

/** Fixa um arquivo. */
export function pinFile(file: RecentFile): RecentFile[] {
  const current = getPinnedFiles().filter((item) => item.path !== file.path)
  const updated = [...current, file]
  store.set('pinnedFiles', updated)
  return updated
}

/** Remove um arquivo dos fixados. */
export function unpinFile(path: string): RecentFile[] {
  const updated = getPinnedFiles().filter((item) => item.path !== path)
  store.set('pinnedFiles', updated)
  return updated
}

/** Retorna todas as configurações atuais. */
export function getSettings(): ProsaSettings {
  const raw = store.store as StoredSettings
  const normalized = normalizeSettings(raw)

  if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
    store.clear()
    store.set(normalized)
  }

  return normalized
}

/** Atualiza parcialmente as configurações e devolve o estado final. */
export function setSettings(partial: Partial<ProsaSettings>): ProsaSettings {
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined) {
      store.set(key, value)
    }
  }
  return getSettings()
}

/** Retorna a lista de arquivos recentes (máximo de 10). */
export function getRecentFiles(): RecentFile[] {
  return store.get('recentFiles', [])
}

/**
 * Registra um arquivo na lista de recentes, movendo-o para o topo e
 * limitando a lista a 10 itens.
 */
export function addRecentFile(file: RecentFile): RecentFile[] {
  const current = getRecentFiles().filter((item) => item.path !== file.path)
  const updated = [file, ...current].slice(0, 10)
  store.set('recentFiles', updated)
  return updated
}

/** Remove um arquivo da lista de recentes (ex.: arquivo inexistente). */
export function removeRecentFile(path: string): RecentFile[] {
  const updated = getRecentFiles().filter((item) => item.path !== path)
  store.set('recentFiles', updated)
  return updated
}

/** Limpa completamente a lista de arquivos recentes. */
export function clearRecentFiles(): RecentFile[] {
  store.set('recentFiles', [])
  return []
}
