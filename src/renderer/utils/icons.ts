// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

// NOTA: Como o Electron tem acesso ao sistema de arquivos, mas o renderer é 
// limitado, vamos carregar os ícones via IPC ou como assets.
// Para facilitar a implementação inicial, vamos usar um mapeamento de ícones
// importando o SVG como string.
// Alternativa: carregar via fetch (se o bundle processar a pasta assets)

/**
 * Retorna o conteúdo SVG de um ícone do Lucide.
 * Em um cenário real de produção, esse mapeamento pode ser gerado dinamicamente.
 */
export async function getIcon(name: string): Promise<string> {
  const url = `assets/icons/${name}.svg`
  try {
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} for ${url}`)
    }
    const text = await response.text()
    
    // Parse o SVG para injetar atributos de estilo dinâmicos
    const parser = new DOMParser()
    const doc = parser.parseFromString(text, 'image/svg+xml')
    const svg = doc.querySelector('svg')
    if (svg) {
      svg.setAttribute('stroke', 'currentColor')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('width', '18')
      svg.setAttribute('height', '18')
      return svg.outerHTML
    }
    return text
  } catch (e) {
    console.error(`Falha ao carregar ícone de ${url}:`, e)
    return ''
  }
}
