// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { NoteEntry, TipTapJSON } from '../../shared/types.js'
import { showConfirm } from './app-dialogs.js'

interface NoteItem {
  id: string
  kind: NoteEntry['kind']
  number: number
  text: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export class NotePanel {
  private readonly container: HTMLElement
  private items: NoteItem[] = []

  constructor(
    container: HTMLElement,
    private readonly onEdit: (id: string) => void,
    private readonly onRemove: (id: string) => void
  ) {
    this.container = container
  }

  update(doc: TipTapJSON, notes: Record<string, NoteEntry>): void {
    const refs = this.collectRefs(doc)
    const counters = { footnote: 0, endnote: 0 }
    const items: NoteItem[] = []
    for (const ref of refs) {
      const entry = notes[ref.id]
      if (!entry) continue
      counters[entry.kind] += 1
      items.push({
        id: entry.id,
        kind: entry.kind,
        number: counters[entry.kind],
        text: entry.text
      })
    }
    this.items = items
    this.render()
  }

  getItems(kind?: NoteEntry['kind']): NoteItem[] {
    return kind ? this.items.filter((item) => item.kind === kind) : [...this.items]
  }

  private collectRefs(doc: TipTapJSON): { id: string; kind: NoteEntry['kind'] }[] {
    const refs: { id: string; kind: NoteEntry['kind'] }[] = []
    const walk = (node: TipTapJSON): void => {
      if (node.type === 'noteReference') {
        const id = String(node.attrs?.noteId ?? '').trim()
        const kind = node.attrs?.kind === 'endnote' ? 'endnote' : 'footnote'
        if (id) refs.push({ id, kind })
      }
      node.content?.forEach(walk)
    }
    walk(doc)
    return refs
  }

  private render(): void {
    const footnotes = this.items.filter((item) => item.kind === 'footnote')
    const endnotes = this.items.filter((item) => item.kind === 'endnote')
    this.container.innerHTML = `
      <div class="note-panel">
        <div class="panel-title">Notas</div>
        ${
          footnotes.length > 0
            ? `
              <div class="note-section-title">Notas de rodapé</div>
              <ol class="note-list">
                ${footnotes.map((item) => `<li data-note-id="${escapeHtml(item.id)}"><button type="button" class="note-item-btn"><span class="note-number">${item.number}</span><span class="note-text">${escapeHtml(item.text)}</span></button></li>`).join('')}
              </ol>
            `
            : '<div class="panel-empty">Nenhuma nota de rodapé.</div>'
        }
        ${
          endnotes.length > 0
            ? `
              <div class="note-section-title">Notas finais</div>
              <ol class="note-list">
                ${endnotes.map((item) => `<li data-note-id="${escapeHtml(item.id)}"><button type="button" class="note-item-btn"><span class="note-number">${item.number}</span><span class="note-text">${escapeHtml(item.text)}</span></button></li>`).join('')}
              </ol>
            `
            : ''
        }
      </div>
    `

    this.container.querySelectorAll<HTMLElement>('[data-note-id]').forEach((item) => {
      const id = item.dataset.noteId
      item.querySelector('.note-item-btn')?.addEventListener('click', () => {
        if (id) this.onEdit(id)
      })
      item.addEventListener('contextmenu', async (event) => {
        event.preventDefault()
        if (id && await showConfirm('Remover esta nota e todas as referências?', 'Remover nota', 'danger', 'Remover')) {
          this.onRemove(id)
        }
      })
    })
  }
}
