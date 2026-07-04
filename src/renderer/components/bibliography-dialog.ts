// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BibliographyStyle, WorkspaceLibraryData } from '../../shared/types.js'
import { formatBibliographyEntry } from '../../shared/bibliography.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface BibliographyDialogCallbacks {
  onInsertCitation: (citeKey: string) => void
  onInsertBibliography: (style: BibliographyStyle, keys: string[]) => void
}

export class BibliographyDialog {
  private readonly overlay: HTMLElement
  private resolve: (() => void) | null = null
  private data: WorkspaceLibraryData | null = null
  private selectedKey: string | null = null

  constructor(
    private readonly callbacks: BibliographyDialogCallbacks,
    parent: HTMLElement = document.body
  ) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  async show(): Promise<void> {
    this.data = await window.prosa.getWorkspaceLibrary()
    this.selectedKey = this.data.bibliography.entries[0]?.key ?? null
    this.render()
    this.overlay.hidden = false
    return new Promise((resolve) => {
      this.resolve = resolve
    })
  }

  hide(): void {
    this.overlay.hidden = true
    this.overlay.innerHTML = ''
    this.resolve?.()
    this.resolve = null
  }

  private get bibliography() {
    return this.data?.bibliography ?? { style: 'ABNT' as BibliographyStyle, entries: [], importedAt: null }
  }

  private async refresh(): Promise<void> {
    this.data = await window.prosa.getWorkspaceLibrary()
    this.render()
  }

  private render(): void {
    const bibliography = this.bibliography
    const search = this.overlay.querySelector<HTMLInputElement>('#bibliography-search')?.value ?? ''
    const previousStyle = this.overlay.querySelector<HTMLSelectElement>('#bibliography-style')?.value ?? bibliography.style
    const filtered = bibliography.entries.filter((entry) => {
      const text = [entry.key, entry.title, entry.author, entry.year, entry.journal, entry.publisher, entry.booktitle]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return !search || text.includes(search.toLowerCase())
    })
    const selected = filtered.find((entry) => entry.key === this.selectedKey) ?? filtered[0] ?? null
    this.selectedKey = selected?.key ?? null

    this.overlay.innerHTML = `
      <div class="modal modal-wide bibliography-dialog" role="dialog" aria-label="Bibliografia">
        <div class="modal-header">
          <h2>Bibliografia</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <div class="workspace-library-toolbar">
          <input id="bibliography-search" class="palette-input" type="text" placeholder="Buscar por chave, autor ou título" />
          <select id="bibliography-style" class="palette-input">
            <option value="ABNT" ${bibliography.style === 'ABNT' ? 'selected' : ''}>ABNT</option>
            <option value="APA" ${bibliography.style === 'APA' ? 'selected' : ''}>APA</option>
            <option value="IEEE" ${bibliography.style === 'IEEE' ? 'selected' : ''}>IEEE</option>
          </select>
          <button class="btn btn-secondary" id="bibliography-import"><i class="ti ti-file-type-bib"></i> Importar BibTeX</button>
          <button class="btn btn-secondary" id="bibliography-paste"><i class="ti ti-clipboard-text"></i> Colar BibTeX</button>
          <button class="btn btn-primary" id="bibliography-insert-all"><i class="ti ti-book"></i> Inserir bibliografia</button>
        </div>
        <div class="bibliography-dialog-body">
          <section class="workspace-library-list">
            <div class="panel-title">Entradas (${filtered.length})</div>
            ${
              filtered.length > 0
                ? `<div class="workspace-doc-list">${filtered.map((entry) => `
                  <button class="workspace-doc-card ${entry.key === selected?.key ? 'active' : ''}" data-select-key="${escapeHtml(entry.key)}">
                    <div class="workspace-doc-card-title">${escapeHtml(entry.key)}</div>
                    <div class="workspace-doc-card-meta">${escapeHtml(entry.author || 'Autor desconhecido')} · ${escapeHtml(entry.year || 's.d.')}</div>
                    <div class="workspace-doc-card-snippet">${escapeHtml(entry.title)}</div>
                  </button>
                `).join('')}</div>`
                : '<div class="panel-empty">Nenhuma entrada importada.</div>'
            }
          </section>
          <section class="workspace-library-details">
            ${
              selected
                ? `
                  <div class="workspace-section">
                    <div class="panel-title">${escapeHtml(selected.key)}</div>
                    <div class="panel-empty">${escapeHtml(formatBibliographyEntry(selected, previousStyle as BibliographyStyle, 1))}</div>
                  </div>
                  <div class="workspace-bib-toolbar">
                    <button class="btn btn-secondary" id="bibliography-insert-citation"><i class="ti ti-quote"></i> Inserir citação</button>
                    <button class="btn btn-primary" id="bibliography-insert-entry"><i class="ti ti-book"></i> Inserir na lista</button>
                  </div>
                `
                : '<div class="panel-empty">Selecione uma entrada.</div>'
            }
          </section>
        </div>
      </div>
    `

    const searchInput = this.overlay.querySelector<HTMLInputElement>('#bibliography-search')
    if (searchInput) {
      searchInput.value = search
      searchInput.addEventListener('input', () => this.render())
    }

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => this.hide())
    this.overlay.querySelector('#bibliography-style')?.addEventListener('change', async (event) => {
      const style = (event.target as HTMLSelectElement).value as BibliographyStyle
      await window.prosa.setBibliographyStyle(style)
      await this.refresh()
    })

    this.overlay.querySelector('#bibliography-import')?.addEventListener('click', () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.bib,.txt'
      input.onchange = () => {
        const file = input.files?.[0]
        if (file) {
          void file.text().then((content) => window.prosa.importBibTeX(content)).then(() => this.refresh())
        }
      }
      input.click()
    })

    this.overlay.querySelector('#bibliography-paste')?.addEventListener('click', async () => {
      const text = prompt('Cole o BibTeX:')
      if (text) {
        await window.prosa.importBibTeX(text)
        await this.refresh()
      }
    })

    this.overlay.querySelectorAll<HTMLElement>('[data-select-key]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedKey = button.dataset.selectKey ?? null
        this.render()
      })
    })

    this.overlay.querySelector('#bibliography-insert-citation')?.addEventListener('click', () => {
      if (selected?.key) {
        this.callbacks.onInsertCitation(selected.key)
        this.hide()
      }
    })

    this.overlay.querySelector('#bibliography-insert-entry')?.addEventListener('click', () => {
      if (selected?.key) {
        this.callbacks.onInsertBibliography(previousStyle as BibliographyStyle, [selected.key])
        this.hide()
      }
    })

    this.overlay.querySelector('#bibliography-insert-all')?.addEventListener('click', () => {
      this.callbacks.onInsertBibliography(previousStyle as BibliographyStyle, filtered.map((entry) => entry.key))
      this.hide()
    })
  }
}
