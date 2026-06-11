// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

export interface ThemePalette {
    accent: string;
    bg: string;
    surface: string;
}

export function applyTheme(palette: ThemePalette): void {
    const root = document.documentElement;
    root.style.setProperty('--accent', palette.accent);
    root.style.setProperty('--bg', palette.bg);
    root.style.setProperty('--surface', palette.surface);
}
