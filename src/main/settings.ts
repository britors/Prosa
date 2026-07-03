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
  backupOnSave: true,
  backupKeepVersions: 20,
  pdfPageSize: 'A4',
  pdfLandscape: false,
  pdfPrintBackground: true,
  focusWorkMinutes: 25,
  focusBreakMinutes: 5,
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

function normalizePdfPageSize(value: unknown): ProsaSettings['pdfPageSize'] {
  if (value === 'A4' || value === 'Letter' || value === 'Legal') return value
  return defaults.pdfPageSize
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
  const backupKeepVersions = normalizePositiveInt(raw.backupKeepVersions, defaults.backupKeepVersions)
  const pdfPageSize = normalizePdfPageSize(raw.pdfPageSize)
  const pdfLandscape = typeof raw.pdfLandscape === 'boolean' ? raw.pdfLandscape : defaults.pdfLandscape
  const pdfPrintBackground =
    typeof raw.pdfPrintBackground === 'boolean' ? raw.pdfPrintBackground : defaults.pdfPrintBackground
  const backupOnSave = typeof raw.backupOnSave === 'boolean' ? raw.backupOnSave : defaults.backupOnSave
  const focusWorkMinutes = normalizePositiveInt(raw.focusWorkMinutes, defaults.focusWorkMinutes)
  const focusBreakMinutes = normalizePositiveInt(raw.focusBreakMinutes, defaults.focusBreakMinutes)

  return {
    ...defaults,
    ...raw,
    autoSavePolicy,
    autoSaveDebounceSeconds,
    autoSaveIntervalMinutes,
    backupOnSave,
    backupKeepVersions,
    pdfPageSize,
    pdfLandscape,
    pdfPrintBackground,
    focusWorkMinutes,
    focusBreakMinutes
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

/** Remove todos os arquivos fixados. */
export function clearPinnedFiles(): RecentFile[] {
  store.set('pinnedFiles', [])
  return []
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
