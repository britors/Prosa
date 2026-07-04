// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { DOCUMENT_TEMPLATES, type DocumentTemplateChoice } from '../../shared/document-templates.js'

export class DocumentTemplateDialog {
  private readonly overlay: HTMLElement
  private resolve: ((result: DocumentTemplateChoice | null) => void) | null = null

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  choose(): Promise<DocumentTemplateChoice | null> {
    this.render()
    this.overlay.hidden = false
    return new Promise((resolve) => {
      this.resolve = resolve
    })
  }

  private render(): void {
    this.overlay.innerHTML = `
      <div class="modal modal-wide" role="dialog" aria-label="Escolher modelo de documento">
        <div class="modal-header">
          <h2>Novo documento</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <p class="modal-subtitle">Escolha um modelo pronto ou comece com uma página em branco.</p>
        <div class="format-grid">
          <button class="format-card" data-kind="blank">
            <i class="ti ti-file-plus"></i>
            <div class="format-card-body">
              <span class="format-card-title">Em branco</span>
              <span class="format-card-desc">Documento limpo para começar do zero.</span>
            </div>
          </button>
          ${DOCUMENT_TEMPLATES.map(
            (template) => `
            <button class="format-card" data-kind="template" data-template="${template.id}">
              <i class="ti ti-layout"></i>
              <div class="format-card-body">
                <span class="format-card-title">${template.name}</span>
                <span class="format-card-desc">${template.description}</span>
                <span class="format-card-ext">${template.category} • ${template.preferredFormat.toUpperCase()}</span>
              </div>
            </button>`
          ).join('')}
        </div>
      </div>
    `

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => this.close(null))
    this.overlay.querySelectorAll<HTMLElement>('.format-card').forEach((card) => {
      card.addEventListener('click', () => {
        const kind = card.dataset.kind
        if (kind === 'blank') {
          this.close({ kind: 'blank' })
          return
        }
        const templateId = card.dataset.template
        const template = DOCUMENT_TEMPLATES.find((item) => item.id === templateId)
        this.close(template ? { kind: 'template', template } : null)
      })
    })
  }

  private close(result: DocumentTemplateChoice | null): void {
    this.overlay.hidden = true
    this.resolve?.(result)
    this.resolve = null
  }
}
