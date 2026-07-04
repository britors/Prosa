// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { Node, mergeAttributes } from '@tiptap/core'
import { extractNumberedOutline } from '../../../shared/document-utils.js'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      setTableOfContents: (attributes?: { maxLevel?: number; title?: string }) => ReturnType
    }
  }
}

function renderTocInto(dom: HTMLElement, editor: import('@tiptap/core').Editor, maxLevel: number, title: string): void {
  dom.innerHTML = ''

  const heading = document.createElement('div')
  heading.className = 'toc-title'
  heading.textContent = title || 'Sumário'
  dom.appendChild(heading)

  const outline = extractNumberedOutline(editor.getJSON() as Parameters<typeof extractNumberedOutline>[0], maxLevel)
  if (outline.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'panel-empty'
    empty.textContent = 'Nenhum título encontrado.'
    dom.appendChild(empty)
    return
  }

  const list = document.createElement('ul')
  list.className = 'toc-list'
  outline.forEach((item) => {
    const li = document.createElement('li')
    li.className = `toc-item toc-level-${item.level}`
    li.style.paddingLeft = `${(item.level - 1) * 12}px`
    li.textContent = `${item.number} ${item.text || '(sem título)'}`
    li.tabIndex = 0
    li.addEventListener('click', () => {
      const headings = editor.view.dom.querySelectorAll('h1, h2, h3, h4, h5, h6')
      const target = headings[item.index]
      if (target instanceof HTMLElement) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    li.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        li.click()
      }
    })
    list.appendChild(li)
  })
  dom.appendChild(list)
}

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      maxLevel: { default: 4 },
      title: { default: 'Sumário' }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-table-of-contents]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-table-of-contents': 'true',
        contenteditable: 'false'
      })
    ]
  },

  addNodeView() {
    return ({ node, editor }) => {
      let currentNode = node
      const dom = document.createElement('div')
      dom.className = 'toc-block'
      renderTocInto(dom, editor, Number(currentNode.attrs.maxLevel ?? 4), String(currentNode.attrs.title ?? 'Sumário'))

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== currentNode.type.name) return false
          currentNode = updatedNode
          renderTocInto(dom, editor, Number(currentNode.attrs.maxLevel ?? 4), String(currentNode.attrs.title ?? 'Sumário'))
          return true
        }
      }
    }
  },

  addCommands() {
    return {
      setTableOfContents:
        (attributes = {}) =>
        ({ chain }) =>
          chain().insertContent({ type: this.name, attrs: attributes }).run()
    }
  }
})
