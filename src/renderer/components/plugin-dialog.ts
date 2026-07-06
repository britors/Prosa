// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PluginInfo } from '../../shared/types.js'
import { showAlert } from './app-dialogs.js'

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
              const actionButtons =
                p.status === 'loaded'
                  ? `
                    <button class="btn btn-secondary btn-sm plugin-action" data-action="disable" data-plugin="${escapeHtml(p.id)}">
                      <i class="ti ti-player-pause"></i> Desativar
                    </button>
                    <button class="btn btn-ghost btn-sm plugin-action" data-action="remove" data-plugin="${escapeHtml(p.id)}">
                      <i class="ti ti-trash"></i> Remover
                    </button>`
                  : p.status === 'disabled'
                    ? `
                    <button class="btn btn-secondary btn-sm plugin-action" data-action="enable" data-plugin="${escapeHtml(p.id)}">
                      <i class="ti ti-player-play"></i> Ativar
                    </button>
                    <button class="btn btn-ghost btn-sm plugin-action" data-action="remove" data-plugin="${escapeHtml(p.id)}">
                      <i class="ti ti-trash"></i> Remover
                    </button>`
                    : `
                    <button class="btn btn-ghost btn-sm plugin-action" data-action="remove" data-plugin="${escapeHtml(p.id)}">
                      <i class="ti ti-trash"></i> Remover
                    </button>`
              return `
            <div class="format-card" data-current="${loaded}">
              <i class="ti ti-plug"></i>
              <div class="format-card-body">
                <span class="format-card-title">
                  ${escapeHtml(p.name)}
                  <span class="format-card-ext">v${escapeHtml(p.version)}</span>
                  <span class="plugin-status plugin-status-${p.status}">
                    ${p.status === 'loaded' ? 'Ativo' : p.status === 'disabled' ? 'Desativado' : 'Falha'}
                  </span>
                </span>
                <span class="format-card-desc">Permissões: ${escapeHtml(permissions)}</span>
                ${p.description ? `<span class="format-card-desc">${escapeHtml(p.description)}</span>` : ''}
                ${p.status === 'error' ? '<span class="format-card-desc plugin-error-text">Verifique o manifesto e o entrypoint. O plugin pode ser removido e reinstalado.</span>' : ''}
                ${p.error ? `<span class="format-card-desc plugin-error-text">${escapeHtml(p.error)}</span>` : ''}
                <div class="plugin-actions">
                  ${actionButtons}
                </div>
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
    this.overlay.querySelectorAll<HTMLElement>('.plugin-action').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault()
        event.stopPropagation()
        const id = button.dataset.plugin
        const action = button.dataset.action
        if (!id || !action) return

        try {
          const plugins =
            action === 'enable'
              ? await window.prosa.enablePlugin(id)
              : action === 'disable'
                ? await window.prosa.disablePlugin(id)
                : await window.prosa.removePlugin(id)
          this.render(plugins)
        } catch (error) {
          await showAlert(error instanceof Error ? error.message : String(error), 'Erro no plugin', 'danger')
        }
      })
    })
  }
}
