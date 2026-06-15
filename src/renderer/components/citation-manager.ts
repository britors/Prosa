// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Editor } from '@tiptap/core'

export class CitationManager {
  private readonly editor: Editor
  // @ts-ignore
  private readonly container: HTMLElement
  private element: HTMLElement | null = null

  constructor(container: HTMLElement, editor: Editor) {
    this.container = container
    this.editor = editor
  }

  show(): void {
    if (this.element) return

    this.element = document.createElement('div')
    this.element.className = 'citation-manager'
    this.element.innerHTML = `
      <div class="prompt-title">Inserir Citação (BibTeX Key)</div>
      <input type="text" class="palette-input" placeholder="Ex: author2023" />
      <div class="prompt-actions">
        <button class="btn btn-cancel">Cancelar</button>
        <button class="btn btn-primary btn-save">OK</button>
      </div>
    `

    const input = this.element.querySelector('input') as HTMLInputElement
    const btnSave = this.element.querySelector('.btn-save') as HTMLButtonElement
    const btnCancel = this.element.querySelector('.btn-cancel') as HTMLButtonElement

    const close = () => {
      this.element?.remove()
      this.element = null
      this.editor.commands.focus()
    }

    btnSave.onclick = () => {
      if (input.value) {
        this.editor.commands.setCitation({ citeKey: input.value })
      }
      close()
    }

    btnCancel.onclick = close
    document.body.appendChild(this.element)
    input.focus()
  }
}
