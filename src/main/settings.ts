// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import Store from 'electron-store'
import { randomUUID } from 'node:crypto'
import type { AutoSavePolicy, FontProfile, PdfPreset, ProsaSettings, RecentFile } from '../shared/types.js'

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
  pdfPreset: 'academic',
  focusWorkMinutes: 25,
  focusBreakMinutes: 5,
  wordGoal: 0,
  fontProfiles: [],
  activeFontProfileId: 'serif',
  showWordCount: true,
  showOutline: true,
  showNotes: false,
  showRelations: false,
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

function normalizePdfPreset(value: unknown): PdfPreset {
  if (value === 'academic' || value === 'report' || value === 'contract' || value === 'book') return value
  return defaults.pdfPreset
}

function isFontProfile(value: unknown): value is FontProfile {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.fontFamily === 'string' &&
    typeof p.fontSize === 'number' &&
    typeof p.lineHeight === 'number'
  )
}

function normalizeFontProfiles(value: unknown): FontProfile[] {
  if (!Array.isArray(value)) return defaults.fontProfiles
  return value.filter(isFontProfile)
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
  const pdfPreset = normalizePdfPreset(raw.pdfPreset)
  const backupOnSave = typeof raw.backupOnSave === 'boolean' ? raw.backupOnSave : defaults.backupOnSave
  const focusWorkMinutes = normalizePositiveInt(raw.focusWorkMinutes, defaults.focusWorkMinutes)
  const focusBreakMinutes = normalizePositiveInt(raw.focusBreakMinutes, defaults.focusBreakMinutes)
  const wordGoal =
    typeof raw.wordGoal === 'number' && Number.isFinite(raw.wordGoal)
      ? Math.max(0, Math.round(raw.wordGoal))
      : defaults.wordGoal
  const fontProfiles = normalizeFontProfiles(raw.fontProfiles)
  const activeFontProfileId =
    typeof raw.activeFontProfileId === 'string' ? raw.activeFontProfileId : defaults.activeFontProfileId

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
    pdfPreset,
    focusWorkMinutes,
    focusBreakMinutes,
    wordGoal,
    fontProfiles,
    activeFontProfileId
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

/** Salva um novo perfil de fonte customizado. */
export function saveFontProfile(profile: Omit<FontProfile, 'id'>): FontProfile[] {
  const current = store.get('fontProfiles', [])
  const updated = [...current, { ...profile, id: randomUUID() }]
  store.set('fontProfiles', updated)
  return updated
}

/** Remove um perfil de fonte customizado. */
export function deleteFontProfile(id: string): FontProfile[] {
  const updated = store.get('fontProfiles', []).filter((p) => p.id !== id)
  store.set('fontProfiles', updated)
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
