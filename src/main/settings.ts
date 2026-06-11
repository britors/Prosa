// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import Store from 'electron-store'
import type { ProsaSettings, RecentFile } from '../shared/types.js'

/** Valores padrão das configurações do Prosa. */
const defaults: ProsaSettings = {
  theme: 'dark',
  fontSize: 12,
  fontFamily: 'Georgia',
  lineHeight: 1.6,
  spellcheck: true,
  spellLanguages: ['pt-BR', 'en-US'],
  autoSave: true,
  autoSaveInterval: 30,
  showWordCount: true,
  showOutline: true,
  recentFiles: [],
  zoom: 100
}

const store = new Store<ProsaSettings>({ name: 'prosa-settings', defaults })

/** Retorna todas as configurações atuais. */
export function getSettings(): ProsaSettings {
  return {
    ...defaults,
    ...(store.store as ProsaSettings)
  }
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
