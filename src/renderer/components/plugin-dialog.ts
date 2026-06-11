// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

export class PluginDialog {
  private readonly overlay: HTMLElement

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  async show(): Promise<void> {
    const plugins = await window.prosa.getPlugins()
    this.render(plugins)
    this.overlay.hidden = false
  }

  private render(plugins: { id: string; name: string }[]): void {
    this.overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Plugins">
        <div class="modal-header">
          <h2>Plugins</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <div class="format-grid">
          ${plugins.map(
            (p) => `
            <div class="format-card">
              <i class="ti ti-plug"></i>
              <div class="format-card-body">
                <span class="format-card-title">${p.name}</span>
              </div>
            </div>`
          ).join('')}
        </div>
      </div>
    `
    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => (this.overlay.hidden = true))
  }
}
