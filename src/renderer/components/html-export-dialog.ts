// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { HtmlExportMode, HtmlExportOptions } from '../../shared/types.js'

export class HtmlExportDialog {
  private readonly overlay: HTMLElement
  private resolve: ((options: HtmlExportOptions | null) => void) | null = null
  private mode: HtmlExportMode = 'full'
  private includeStyles = true

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  choose(): Promise<HtmlExportOptions | null> {
    this.render()
    this.overlay.hidden = false
    return new Promise((resolve) => {
      this.resolve = resolve
    })
  }

  private render(): void {
    this.overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Exportar HTML">
        <div class="modal-header">
          <h2>Exportar HTML limpo</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <p class="modal-subtitle">Escolha o modo de saída e o CSS mínimo opcional.</p>
        <div class="html-export-grid">
          <button class="format-card html-mode-card" data-mode="full" data-current="${this.mode === 'full'}">
            <i class="ti ti-browser"></i>
            <div class="format-card-body">
              <span class="format-card-title">Documento completo</span>
              <span class="format-card-desc">Gera um arquivo HTML pronto para publicar.</span>
            </div>
          </button>
          <button class="format-card html-mode-card" data-mode="content" data-current="${this.mode === 'content'}">
            <i class="ti ti-code"></i>
            <div class="format-card-body">
              <span class="format-card-title">Somente conteúdo</span>
              <span class="format-card-desc">Exporta apenas o corpo do documento.</span>
            </div>
          </button>
        </div>
        <label class="html-export-option">
          <input type="checkbox" id="html-include-styles" ${this.includeStyles ? 'checked' : ''} />
          Incluir CSS mínimo para aparência básica
        </label>
        <div class="prompt-actions">
          <button class="btn btn-cancel" id="html-cancel">Cancelar</button>
          <button class="btn btn-primary" id="html-export">Exportar</button>
        </div>
      </div>
    `

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => this.close(null))
    this.overlay.querySelector('#html-cancel')?.addEventListener('click', () => this.close(null))
    this.overlay.querySelectorAll<HTMLElement>('.html-mode-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.mode = (card.dataset.mode as HtmlExportMode) ?? 'full'
        this.render()
      })
    })
    this.overlay.querySelector('#html-include-styles')?.addEventListener('change', (event) => {
      this.includeStyles = (event.target as HTMLInputElement).checked
    })
    this.overlay.querySelector('#html-export')?.addEventListener('click', () => {
      this.close({ mode: this.mode, includeStyles: this.includeStyles })
    })
  }

  private close(options: HtmlExportOptions | null): void {
    this.overlay.hidden = true
    this.resolve?.(options)
    this.resolve = null
  }
}

