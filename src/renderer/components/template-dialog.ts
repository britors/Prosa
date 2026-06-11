// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

export class TemplateDialog {
  private readonly overlay: HTMLElement
  private resolve: ((templateId: string | null) => void) | null = null

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  async choose(): Promise<string | null> {
    const templates = await window.prosa.getTemplates()
    this.render(templates)
    this.overlay.hidden = false
    return new Promise((resolve) => {
      this.resolve = resolve
    })
  }

  private render(templates: { id: string; name: string }[]): void {
    this.overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Escolher template">
        <div class="modal-header">
          <h2>Exportar PDF</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <p class="modal-subtitle">Escolha um template de exportação:</p>
        <div class="format-grid">
          <button class="format-card" data-template="">
            <i class="ti ti-file-text"></i>
            <div class="format-card-body">
              <span class="format-card-title">Padrão</span>
            </div>
          </button>
          ${templates.map(
            (t) => `
            <button class="format-card" data-template="${t.id}">
              <i class="ti ti-layout-template"></i>
              <div class="format-card-body">
                <span class="format-card-title">${t.name}</span>
              </div>
            </button>`
          ).join('')}
        </div>
      </div>
    `

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () =>
      this.close(null)
    )
    this.overlay.querySelectorAll<HTMLElement>('.format-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.close(card.dataset.template ?? null)
      })
    })
  }

  private close(templateId: string | null): void {
    this.overlay.hidden = true
    this.resolve?.(templateId)
    this.resolve = null
  }
}
