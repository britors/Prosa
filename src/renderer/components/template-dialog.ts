// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { showAlert, showConfirm } from './app-dialogs.js'

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
      <div class="modal" role="dialog" aria-label="Gerenciar Templates">
        <div class="modal-header">
          <h2>Gerenciar Templates</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <p class="modal-subtitle">Escolha um template ou crie um novo:</p>
        <div class="template-actions" style="margin-bottom: 20px;">
           <input type="text" id="new-template-name" placeholder="Nome do novo template" class="btn">
           <button id="btn-create-template" class="btn btn-primary">Salvar template atual</button>
        </div>
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
              <i class="ti ti-trash btn-delete" data-id="${t.id}" title="Excluir"></i>
            </button>`
          ).join('')}
        </div>
      </div>
    `

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () =>
      this.close(null)
    )
    this.overlay.querySelector('#btn-create-template')?.addEventListener('click', () => {
        const input = this.overlay.querySelector('#new-template-name') as HTMLInputElement
        this.createNewTemplate(input.value)
    })
    this.overlay.querySelectorAll<HTMLElement>('.btn-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (await showConfirm('Tem certeza que deseja excluir este template?', 'Excluir template', 'danger', 'Excluir')) {
            await window.prosa.deleteTemplate(btn.dataset.id!)
            this.choose()
        }
      })
    })
    this.overlay.querySelectorAll<HTMLElement>('.format-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.close(card.dataset.template ?? null)
      })
    })
  }

  private async createNewTemplate(name: string): Promise<void> {
    if (!name) {
        await showAlert('Por favor, insira um nome para o template.', 'Nome obrigatório', 'warning')
        return
    }
    
    // Supondo que o CSS do template atual esteja em um estilo específico
    const styleEl = document.getElementById('theme-style') as HTMLStyleElement
    const css = styleEl ? styleEl.innerHTML : ''
    
    await window.prosa.saveTemplate(name, css)
    this.overlay.hidden = true // Fecha para recarregar
    this.choose() // Recarrega a lista
  }

  private close(templateId: string | null): void {
    this.overlay.hidden = true
    this.resolve?.(templateId)
    this.resolve = null
  }
}
