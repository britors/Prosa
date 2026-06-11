// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

/** Tema de documento: ajusta tipografia e largura da área de edição. */
export interface DocumentTheme {
  id: string
  label: string
  fontFamily: string
  className: string
}

/** Temas de documento disponíveis (apenas tipografia; app é dark-only). */
export const DOCUMENT_THEMES: DocumentTheme[] = [
  {
    id: 'serif',
    label: 'Serifado (Georgia)',
    fontFamily: "Georgia, 'Times New Roman', serif",
    className: 'theme-serif'
  },
  {
    id: 'sans',
    label: 'Sem serifa (Inter)',
    fontFamily: "Inter, system-ui, sans-serif",
    className: 'theme-sans'
  },
  {
    id: 'mono',
    label: 'Monoespaçado',
    fontFamily: "'Courier New', monospace",
    className: 'theme-mono'
  }
]

/**
 * Aplica um tema de documento ao elemento do editor, trocando a classe e a
 * família de fonte base da área de edição.
 */
export function applyDocumentTheme(editorEl: HTMLElement, themeId: string): void {
  const theme = DOCUMENT_THEMES.find((t) => t.id === themeId) ?? DOCUMENT_THEMES[0]
  for (const t of DOCUMENT_THEMES) {
    editorEl.classList.remove(t.className)
  }
  editorEl.classList.add(theme.className)
  editorEl.style.setProperty('--document-font', theme.fontFamily)
}
