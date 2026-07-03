// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { FontProfile } from '../../shared/types.js'

/** Perfis embutidos — não persistidos, sempre disponíveis e não deletáveis. */
export const BUILTIN_FONT_PROFILES: FontProfile[] = [
  {
    id: 'serif',
    name: 'Serifado (Georgia)',
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontSize: 12,
    lineHeight: 1.6
  },
  {
    id: 'sans',
    name: 'Sem serifa (Inter)',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 12,
    lineHeight: 1.6
  },
  {
    id: 'mono',
    name: 'Monoespaçado',
    fontFamily: "'Courier New', monospace",
    fontSize: 11,
    lineHeight: 1.5
  }
]

/** Resolve um perfil por id entre os embutidos e os customizados, com fallback seguro. */
export function resolveFontProfile(id: string, custom: FontProfile[]): FontProfile {
  return (
    BUILTIN_FONT_PROFILES.find((p) => p.id === id) ??
    custom.find((p) => p.id === id) ??
    BUILTIN_FONT_PROFILES[0]
  )
}

/** Aplica um perfil de fonte à área de edição via custom properties CSS. */
export function applyFontProfile(editorEl: HTMLElement, profile: FontProfile): void {
  editorEl.style.setProperty('--document-font', profile.fontFamily)
  editorEl.style.setProperty('--document-font-size', `${profile.fontSize}pt`)
  editorEl.style.setProperty('--document-line-height', String(profile.lineHeight))
}
