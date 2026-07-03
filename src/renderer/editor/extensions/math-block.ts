// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { Node, mergeAttributes } from '@tiptap/core'
import katex from 'katex'

/** Parâmetros repassados ao pedir a edição de uma fórmula. */
export interface MathEditRequest {
  event: MouseEvent
  latex: string
  onSave: (latex: string) => void
}

export interface MathBlockOptions {
  onEditRequest?: (request: MathEditRequest) => void
}

/** Renderiza uma string LaTeX para HTML via KaTeX, sem lançar em caso de erro. */
function renderLatex(latex: string): string {
  try {
    return katex.renderToString(latex || '\\text{(fórmula vazia)}', {
      throwOnError: false,
      displayMode: true
    })
  } catch {
    return `<span class="math-error">Erro ao renderizar fórmula.</span>`
  }
}

/**
 * Bloco de fórmula matemática (LaTeX), renderizado via KaTeX. É um nó atômico:
 * o LaTeX vive num atributo, não como conteúdo editável — clicar no bloco
 * renderizado aciona onEditRequest para editar o texto bruto.
 */
export const MathBlock = Node.create<MathBlockOptions>({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { onEditRequest: undefined }
  },

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element) => decodeURIComponent(element.getAttribute('data-latex') ?? ''),
        renderHTML: (attributes) => ({ 'data-latex': encodeURIComponent(String(attributes.latex ?? '')) })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-math-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-math-block': 'true', contenteditable: 'false' })
    ]
  },

  addNodeView() {
    return ({ node, getPos }) => {
      let currentNode = node

      const wrapper = document.createElement('div')
      wrapper.className = 'math-block'
      wrapper.setAttribute('contenteditable', 'false')
      wrapper.setAttribute('data-math-block', 'true')
      wrapper.title = 'Clique para editar a fórmula'

      const renderInto = (): void => {
        const latex = String(currentNode.attrs.latex ?? '')
        wrapper.dataset.latex = encodeURIComponent(latex)
        wrapper.innerHTML = renderLatex(latex)
      }

      wrapper.addEventListener('click', (event) => {
        if (typeof getPos !== 'function') return
        const pos = getPos()
        this.options.onEditRequest?.({
          event: event as MouseEvent,
          latex: String(currentNode.attrs.latex ?? ''),
          onSave: (latex: string) => {
            this.editor
              .chain()
              .command(({ tr }) => {
                tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, latex })
                return true
              })
              .run()
          }
        })
      })

      renderInto()

      return {
        dom: wrapper,
        update(updatedNode) {
          if (updatedNode.type.name !== currentNode.type.name) return false
          currentNode = updatedNode
          renderInto()
          return true
        }
      }
    }
  }
})
