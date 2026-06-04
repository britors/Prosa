// Prosa — Editor de Texto
// Copyright (C) 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Editor } from '@tiptap/core'
import type { ParagraphStyle } from '../../shared/types.js'

/** Definição de um estilo rápido de parágrafo. */
interface StyleDef {
  id: ParagraphStyle
  label: string
  preview: string
  apply: (editor: Editor) => void
  isActive: (editor: Editor) => boolean
}

/** Lista de estilos rápidos disponíveis no painel. */
const STYLES: StyleDef[] = [
  {
    id: 'paragraph',
    label: 'Normal',
    preview: 'style-normal',
    apply: (e) => e.chain().focus().setParagraph().run(),
    isActive: (e) => e.isActive('paragraph')
  },
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    id: `heading${level}` as ParagraphStyle,
    label: `Título ${level}`,
    preview: `style-h${level}`,
    apply: (e: Editor) => e.chain().focus().toggleHeading({ level }).run(),
    isActive: (e: Editor) => e.isActive('heading', { level })
  })),
  {
    id: 'blockquote',
    label: 'Citação',
    preview: 'style-quote',
    apply: (e) => e.chain().focus().toggleBlockquote().run(),
    isActive: (e) => e.isActive('blockquote')
  },
  {
    id: 'codeBlock',
    label: 'Bloco de código',
    preview: 'style-code',
    apply: (e) => e.chain().focus().toggleCodeBlock().run(),
    isActive: (e) => e.isActive('codeBlock')
  }
]

/**
 * Painel de estilos de parágrafo. Cada estilo é aplicado ao parágrafo ou à
 * seleção atual com um clique e exibe seu estado ativo.
 */
export class StylesPanel {
  private readonly container: HTMLElement
  private readonly editor: Editor
  private readonly items: { el: HTMLButtonElement; def: StyleDef }[] = []

  constructor(container: HTMLElement, editor: Editor) {
    this.container = container
    this.editor = editor
    this.build()
  }

  /** Monta os botões de estilo dentro do container. */
  private build(): void {
    const heading = document.createElement('div')
    heading.className = 'panel-title'
    heading.textContent = 'Estilos'
    this.container.appendChild(heading)

    for (const def of STYLES) {
      const button = document.createElement('button')
      button.className = `style-item ${def.preview}`
      button.textContent = def.label
      button.addEventListener('click', () => {
        def.apply(this.editor)
        this.editor.view.focus()
      })
      this.container.appendChild(button)
      this.items.push({ el: button, def })
    }
  }

  /** Atualiza o estado ativo dos estilos conforme a seleção. */
  update(): void {
    for (const { el, def } of this.items) {
      el.dataset.active = String(def.isActive(this.editor))
    }
  }
}
