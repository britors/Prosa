// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

export class MetadataPanel {
  private readonly container: HTMLElement

  constructor(container: HTMLElement) {
    this.container = container
  }

  update(tags: string[], onAddTag: (tag: string) => void, onRemoveTag: (tag: string) => void) {
    this.container.innerHTML = `
      <div class="panel-title">Tags</div>
      <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
        ${tags.map(tag => `<span class="outline-item" style="display: flex; align-items: center; gap: 4px; background: var(--border)">${tag} <i class="ti ti-x" style="cursor: pointer;" data-tag="${tag}"></i></span>`).join('')}
      </div>
      <input type="text" placeholder="Nova tag..." id="new-tag-input" style="width: 100%; background: var(--bg); border: 1px solid var(--border); color: white; padding: 4px; border-radius: 4px;">
    `

    this.container.querySelectorAll('.ti-x').forEach(el => {
        el.addEventListener('click', () => onRemoveTag(el.getAttribute('data-tag')!))
    })

    this.container.querySelector('#new-tag-input')?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
            const input = e.target as HTMLInputElement
            if (input.value) {
                onAddTag(input.value)
                input.value = ''
            }
        }
    })
  }
}
