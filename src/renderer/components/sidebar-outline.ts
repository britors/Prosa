// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Editor } from '@tiptap/core'
import { extractOutline, type OutlineItem } from '../../shared/document-utils.js'
import type { TipTapJSON } from '../../shared/types.js'

/**
 * Painel lateral de tópicos (outline). Reconstrói a árvore de títulos a
 * cada atualização do editor e permite navegar clicando em um item.
 */
export class SidebarOutline {
  private readonly container: HTMLElement
  private readonly editor: Editor

  constructor(container: HTMLElement, editor: Editor) {
    this.container = container
    this.editor = editor
  }

  /** Reconstrói a árvore de tópicos a partir do conteúdo atual. */
  update(): void {
    const json = this.editor.getJSON() as TipTapJSON
    const outline = extractOutline(json)
    this.render(outline)
  }

  /** Renderiza os itens do outline no container. */
  private render(outline: OutlineItem[]): void {
    this.container.innerHTML = ''
    const heading = document.createElement('div')
    heading.className = 'panel-title'
    heading.textContent = 'Tópicos'
    this.container.appendChild(heading)

    if (outline.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'panel-empty'
      empty.textContent = 'Nenhum título no documento.'
      this.container.appendChild(empty)
      return
    }

    const list = document.createElement('ul')
    list.className = 'outline-list'
    outline.forEach((item) => {
      const li = document.createElement('li')
      li.className = `outline-item outline-level-${item.level}`
      li.textContent = item.text || '(sem título)'
      li.style.paddingLeft = `${(item.level - 1) * 12 + 8}px`
      li.addEventListener('click', () => this.scrollToHeading(item.index))
      list.appendChild(li)
    })
    this.container.appendChild(list)
  }

  /** Rola o editor até o n-ésimo título do documento. */
  private scrollToHeading(index: number): void {
    const headings = this.editor.view.dom.querySelectorAll('h1, h2, h3, h4, h5, h6')
    const target = headings[index]
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
}
