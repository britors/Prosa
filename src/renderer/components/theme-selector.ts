// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Aplica o tema da aplicação (claro/escuro) ao elemento raiz.
 */
export function setAppTheme(isDark: boolean): void {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
}
