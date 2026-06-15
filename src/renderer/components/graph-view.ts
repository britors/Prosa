// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

export class GraphView {
  // @ts-ignore
  private readonly container: HTMLElement
  private element: HTMLElement | null = null

  constructor(container: HTMLElement) {
    this.container = container
  }

  show(): void {
    if (this.element) return

    this.element = document.createElement('div')
    this.element.className = 'graph-view'
    this.element.innerHTML = `
      <div class="prompt-title">Visualização em Grafo</div>
      <div class="graph-placeholder" style="height: 300px; display: flex; align-items: center; justify-content: center; border: 1px dashed var(--border);">
        Grafo de conexões em desenvolvimento...
      </div>
      <div class="prompt-actions">
        <button class="btn btn-cancel">Fechar</button>
      </div>
    `
    
    this.element.querySelector('.btn-cancel')?.addEventListener('click', () => this.hide())
    document.body.appendChild(this.element)
  }

  hide(): void {
    this.element?.remove()
    this.element = null
  }
}
