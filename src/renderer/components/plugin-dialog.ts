// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PluginInfo } from '../../shared/types.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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

  private render(plugins: PluginInfo[]): void {
    const cards =
      plugins.length === 0
        ? '<p class="format-card-desc">Nenhum plugin instalado.</p>'
        : plugins
            .map((p) => {
              const loaded = p.status === 'loaded'
              const permissions = p.permissions.length > 0 ? p.permissions.join(', ') : 'nenhuma'
              return `
            <div class="format-card" data-current="${loaded}">
              <i class="ti ti-plug"></i>
              <div class="format-card-body">
                <span class="format-card-title">
                  ${escapeHtml(p.name)}
                  <span class="format-card-ext">v${escapeHtml(p.version)}</span>
                  <span class="plugin-status plugin-status-${loaded ? 'loaded' : 'error'}">
                    ${loaded ? 'Carregado' : 'Falha'}
                  </span>
                </span>
                <span class="format-card-desc">Permissões: ${escapeHtml(permissions)}</span>
                ${p.description ? `<span class="format-card-desc">${escapeHtml(p.description)}</span>` : ''}
                ${p.error ? `<span class="format-card-desc plugin-error-text">${escapeHtml(p.error)}</span>` : ''}
              </div>
            </div>`
            })
            .join('')

    this.overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Plugins">
        <div class="modal-header">
          <h2>Plugins</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <div class="format-grid">
          ${cards}
        </div>
      </div>
    `
    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => (this.overlay.hidden = true))
  }
}
