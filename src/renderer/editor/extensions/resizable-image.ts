// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import Image from '@tiptap/extension-image'

const MIN_IMAGE_WIDTH = 80
const MAX_IMAGE_WIDTH = 1400

/** Converte o valor para inteiro positivo quando possível. */
function toInt(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** Extrai largura em px de um atributo style. */
function widthFromStyle(style: string | null): number | null {
  if (!style) return null
  const match = style.match(/width\s*:\s*(\d+)px/i)
  return match ? toInt(match[1]) : null
}

/** Extrai altura em px de um atributo style. */
function heightFromStyle(style: string | null): number | null {
  if (!style) return null
  const match = style.match(/height\s*:\s*(\d+)px/i)
  return match ? toInt(match[1]) : null
}

/** Extensão de imagem com redimensionamento por alça de arraste. */
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) =>
          toInt(element.getAttribute('width')) ?? widthFromStyle(element.getAttribute('style')),
        renderHTML: (attributes) => {
          if (!attributes.width) return {}
          return { width: String(attributes.width) }
        }
      },
      height: {
        default: null,
        parseHTML: (element) =>
          toInt(element.getAttribute('height')) ?? heightFromStyle(element.getAttribute('style')),
        renderHTML: (attributes) => {
          if (!attributes.height) return {}
          return { height: String(attributes.height) }
        }
      }
    }
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let currentNode = node
      let startX = 0
      let startWidth = 0
      let draftWidth: number | null = null
      let resizing = false

      const wrapper = document.createElement('span')
      wrapper.className = 'prosa-image-wrap'
      wrapper.setAttribute('contenteditable', 'false')

      const img = document.createElement('img')
      img.draggable = true

      const handle = document.createElement('button')
      handle.type = 'button'
      handle.className = 'prosa-image-handle'
      handle.setAttribute('aria-label', 'Redimensionar imagem')
      handle.title = 'Arraste para redimensionar'

      const applyAttrsToDom = (): void => {
        const { src, alt, title, width, height } = currentNode.attrs as {
          src?: string
          alt?: string
          title?: string
          width?: number | null
          height?: number | null
        }

        img.src = src ?? ''
        img.alt = alt ?? ''
        img.title = title ?? ''

        if (width) {
          img.style.width = `${width}px`
          img.style.maxWidth = '100%'
        } else {
          img.style.width = ''
          img.style.maxWidth = '100%'
        }

        if (height) {
          img.style.height = `${height}px`
        } else {
          img.style.height = 'auto'
        }
      }

      const commitResize = (nextWidth: number): void => {
        if (typeof getPos !== 'function') return
        const pos = getPos()
        const attrs = { ...(currentNode.attrs as Record<string, unknown>), width: nextWidth, height: null }
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, attrs)
            return true
          })
          .run()
      }

      const onPointerMove = (event: PointerEvent): void => {
        if (!resizing) return
        const delta = event.clientX - startX
        const nextWidth = Math.max(MIN_IMAGE_WIDTH, Math.min(MAX_IMAGE_WIDTH, Math.round(startWidth + delta)))
        draftWidth = nextWidth
        img.style.width = `${nextWidth}px`
        img.style.height = 'auto'
      }

      const onPointerUp = (): void => {
        if (!resizing) return
        resizing = false
        document.body.classList.remove('is-resizing-image')
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)

        if (draftWidth !== null) {
          commitResize(draftWidth)
        }
      }

      handle.addEventListener('pointerdown', (event: PointerEvent) => {
        event.preventDefault()
        event.stopPropagation()

        const rect = img.getBoundingClientRect()
        startX = event.clientX
        startWidth = rect.width
        draftWidth = null
        resizing = true

        document.body.classList.add('is-resizing-image')
        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
      })

      wrapper.addEventListener('click', () => {
        if (typeof getPos !== 'function') return
        const pos = getPos()
        editor.chain().focus().setNodeSelection(pos).run()
      })

      wrapper.appendChild(img)
      wrapper.appendChild(handle)
      applyAttrsToDom()

      return {
        dom: wrapper,
        update(updatedNode) {
          if (updatedNode.type.name !== currentNode.type.name) return false
          currentNode = updatedNode
          applyAttrsToDom()
          return true
        },
        selectNode() {
          wrapper.classList.add('is-selected')
        },
        deselectNode() {
          wrapper.classList.remove('is-selected')
        },
        destroy() {
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerup', onPointerUp)
          document.body.classList.remove('is-resizing-image')
        }
      }
    }
  }
})
