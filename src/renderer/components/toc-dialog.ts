// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

interface TocDialogResult {
  maxLevel: number
  title: string
}

export class TocDialog {
  private readonly overlay: HTMLElement
  private resolve: ((result: TocDialogResult | null) => void) | null = null

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  choose(): Promise<TocDialogResult | null> {
    this.render()
    this.overlay.hidden = false
    return new Promise((resolve) => {
      this.resolve = resolve
    })
  }

  private render(): void {
    this.overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Inserir sumário">
        <div class="modal-header">
          <h2>Inserir sumário</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <p class="modal-subtitle">Escolha até qual nível de título o sumário deve incluir.</p>
        <div class="workspace-bib-toolbar">
          <label class="panel-empty" style="margin:0;">Título</label>
          <input id="toc-title" class="palette-input" type="text" value="Sumário" />
        </div>
        <div class="workspace-bib-toolbar">
          <label class="panel-empty" style="margin:0;">Nível máximo</label>
          <select id="toc-level" class="palette-input">
            ${[1, 2, 3, 4, 5, 6].map((level) => `<option value="${level}" ${level === 4 ? 'selected' : ''}>H${level}</option>`).join('')}
          </select>
        </div>
        <div class="prompt-actions">
          <button class="btn btn-cancel" id="toc-cancel">Cancelar</button>
          <button class="btn btn-primary" id="toc-insert">Inserir</button>
        </div>
      </div>
    `

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => this.close(null))
    this.overlay.querySelector('#toc-cancel')?.addEventListener('click', () => this.close(null))
    this.overlay.querySelector('#toc-insert')?.addEventListener('click', () => {
      const title = this.overlay.querySelector<HTMLInputElement>('#toc-title')?.value.trim() || 'Sumário'
      const maxLevel = Number(this.overlay.querySelector<HTMLSelectElement>('#toc-level')?.value ?? '4')
      this.close({ title, maxLevel: Number.isFinite(maxLevel) ? Math.min(6, Math.max(1, maxLevel)) : 4 })
    })
  }

  private close(result: TocDialogResult | null): void {
    this.overlay.hidden = true
    this.resolve?.(result)
    this.resolve = null
  }
}
