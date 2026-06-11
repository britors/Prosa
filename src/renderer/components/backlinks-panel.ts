// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

export class BacklinksPanel {
  private readonly container: HTMLElement

  constructor(container: HTMLElement) {
    this.container = container
  }

  update(currentDocumentName: string, allTabs: { name: string; content: string }[]) {
    const backlinks = allTabs.filter(tab => 
      tab.name !== currentDocumentName && tab.content.includes(`[[${currentDocumentName}]]`)
    )

    this.container.innerHTML = `
      <div class="panel-title">Backlinks</div>
      ${backlinks.length > 0 
        ? backlinks.map(b => `<div class="outline-item">${b.name}</div>`).join('')
        : '<div class="panel-empty">Nenhum backlink encontrado.</div>'
      }
    `
  }
}
