// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { getFonts } from 'font-list'

/**
 * Fontes web/padrão sempre oferecidas no topo da lista, mesmo que não
 * estejam instaladas no sistema (a UI usa Inter; documentos usam serifadas).
 */
const PREFERRED_FONTS = [
  'Inter',
  'Georgia',
  'Times New Roman',
  'Arial',
  'Courier New'
]

/** Remove aspas ao redor do nome da fonte retornado pelo sistema. */
function cleanName(name: string): string {
  return name.replace(/^["']|["']$/g, '').trim()
}

/**
 * Lista as famílias de fontes instaladas no computador, em ordem
 * alfabética, com as fontes preferidas no topo. Em caso de falha na
 * enumeração, devolve ao menos a lista preferida.
 */
export async function listSystemFonts(): Promise<string[]> {
  try {
    const system = (await getFonts())
      .map(cleanName)
      .filter((name) => name.length > 0)

    const seen = new Set<string>()
    const ordered: string[] = []

    // Preferidas primeiro (apenas as que de fato existem ou são web-safe).
    for (const font of PREFERRED_FONTS) {
      const key = font.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        ordered.push(font)
      }
    }

    // Demais fontes do sistema, em ordem alfabética (pt-BR).
    const rest = system
      .filter((font) => !seen.has(font.toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    for (const font of rest) {
      const key = font.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        ordered.push(font)
      }
    }

    return ordered
  } catch {
    return [...PREFERRED_FONTS]
  }
}
