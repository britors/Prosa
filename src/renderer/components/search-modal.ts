// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

export class SearchModal {
  private readonly overlay: HTMLElement

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  show() {
    this.overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Pesquisa">
        <div class="modal-header">
          <h2>Pesquisar no Workspace</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <input type="text" id="search-input" placeholder="Termo de pesquisa..." style="width: 100%; padding: 10px; background: var(--bg); border: 1px solid var(--border); color: white; border-radius: 6px; margin-bottom: 10px;">
        <div class="search-results" id="search-results" style="max-height: 300px; overflow-y: auto;"></div>
      </div>
    `
    this.overlay.hidden = false
    const input = this.overlay.querySelector<HTMLInputElement>('#search-input')!
    input.focus()
    
    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const results = await window.prosa.searchFiles(input.value)
            this.renderResults(results)
        }
    })
    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => this.hide())
  }

  hide() {
    this.overlay.hidden = true
  }

  private renderResults(results: { path: string; snippet: string }[]) {
    const list = this.overlay.querySelector('#search-results')!
    list.innerHTML = results.map(r => `
        <div class="search-result" style="padding: 5px; cursor: pointer; border-bottom: 1px solid var(--border);">
            <div style="font-weight: bold;">${r.path}</div>
            <div style="font-size: 0.9em; color: #888;">...${r.snippet}...</div>
        </div>
    `).join('')
    
    list.querySelectorAll('.search-result').forEach((el, i) => {
        el.addEventListener('click', () => {
            window.prosa.openDocument(results[i].path)
            this.hide()
        })
    })
  }
}
