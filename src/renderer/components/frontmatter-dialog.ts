// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export class FrontmatterDialog {
  private readonly overlay: HTMLElement
  private rows: { key: string; value: string }[] = []
  private onSave: (frontmatter: Record<string, string>) => void = () => {}

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  show(current: Record<string, string>, onSave: (frontmatter: Record<string, string>) => void): void {
    this.rows = Object.entries(current).map(([key, value]) => ({ key, value }))
    this.onSave = onSave
    this.render()
    this.overlay.hidden = false
  }

  private render(): void {
    const rowsHtml = this.rows
      .map(
        (row, i) => `
        <div class="frontmatter-row">
          <input type="text" class="field-select fm-key" data-index="${i}" placeholder="chave" value="${escapeHtml(row.key)}">
          <input type="text" class="field-select fm-value" data-index="${i}" placeholder="valor" value="${escapeHtml(row.value)}">
          <button class="btn btn-ghost btn-sm fm-remove" data-index="${i}" title="Remover"><i class="ti ti-trash"></i></button>
        </div>`
      )
      .join('')

    this.overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Editar Frontmatter">
        <div class="modal-header">
          <h2>Frontmatter</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <p class="format-card-desc">Metadados YAML gravados no topo do arquivo .md (título, data, tags, etc).</p>
        <div class="frontmatter-rows">${rowsHtml}</div>
        <div class="frontmatter-actions">
          <button id="btn-add-field" class="btn btn-ghost btn-sm">+ Adicionar campo</button>
          <button id="btn-save-frontmatter" class="btn btn-primary">Salvar</button>
        </div>
      </div>
    `

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => (this.overlay.hidden = true))

    this.overlay.querySelectorAll<HTMLInputElement>('.fm-key').forEach((input) => {
      input.addEventListener('input', () => {
        const i = Number(input.dataset.index)
        if (this.rows[i]) this.rows[i].key = input.value
      })
    })
    this.overlay.querySelectorAll<HTMLInputElement>('.fm-value').forEach((input) => {
      input.addEventListener('input', () => {
        const i = Number(input.dataset.index)
        if (this.rows[i]) this.rows[i].value = input.value
      })
    })
    this.overlay.querySelectorAll<HTMLElement>('.fm-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.index)
        this.rows.splice(i, 1)
        this.render()
      })
    })

    this.overlay.querySelector('#btn-add-field')?.addEventListener('click', () => {
      this.rows.push({ key: '', value: '' })
      this.render()
    })

    this.overlay.querySelector('#btn-save-frontmatter')?.addEventListener('click', () => {
      const frontmatter: Record<string, string> = {}
      for (const row of this.rows) {
        if (row.key.trim()) frontmatter[row.key.trim()] = row.value
      }
      this.onSave(frontmatter)
      this.overlay.hidden = true
    })
  }
}
