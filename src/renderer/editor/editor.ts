// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Underline } from '@tiptap/extension-underline'
import { TextAlign } from '@tiptap/extension-text-align'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Image } from '@tiptap/extension-image'
import { Link } from '@tiptap/extension-link'
import { Highlight } from '@tiptap/extension-highlight'
import { Typography } from '@tiptap/extension-typography'
import { Placeholder } from '@tiptap/extension-placeholder'
import { CharacterCount } from '@tiptap/extension-character-count'
import { Color } from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import { FontFamily } from '@tiptap/extension-font-family'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import { PageBreak } from './extensions/page-break.js'
import { Wikilink } from './extensions/wikilink.js'
import { Tag } from './extensions/tag.js'
import { Citation } from './extensions/citation.js'
import { FontSize } from './extensions/font-size.js'
import { FindReplace } from './extensions/find-replace.js'
import { PaginationPlus } from 'tiptap-pagination-plus'

/** Callbacks de ciclo de vida do editor. */
export interface EditorCallbacks {
  onUpdate: (editor: Editor) => void
  onSelectionUpdate: (editor: Editor) => void
  onMatchesUpdate: (current: number, total: number) => void
  onHeaderClick?: (params: { event: MouseEvent }) => void
  onFooterClick?: (params: { event: MouseEvent }) => void
}

/** Cria e configura a instância do editor TipTap do Prosa. */
export function createEditor(
  element: HTMLElement,
  callbacks: EditorCallbacks
): Editor {
  return new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] }
      }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Highlight.configure({ multicolor: true }),
      Typography,
      Placeholder.configure({
        placeholder: 'Comece a escrever sua prosa...'
      }),
      CharacterCount,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Subscript,
      Superscript,
      TaskList,
      TaskItem.configure({ nested: true }),
      PageBreak,
      Wikilink,
      Tag,
      Citation,
      FindReplace.configure({ onMatchesUpdate: callbacks.onMatchesUpdate }),
      PaginationPlus.configure({
        pageHeight: 1123, // A4
        pageWidth: 794,   // A4
        marginTop: 48,    // 1.27cm (Distância da borda ao cabeçalho)
        marginBottom: 48, // 1.27cm (Distância da borda ao rodapé)
        marginLeft: 96,   // 2.54cm
        marginRight: 96,  // 2.54cm
        contentMarginTop: 48,    // 1.27cm (Distância do cabeçalho ao texto)
        contentMarginBottom: 48, // 1.27cm (Distância do texto ao rodapé)
        pageGap: 30,      // Espaço entre páginas
        headerLeft: '',
        footerRight: 'Página {page}',
        onHeaderClick: (params: any) => {
          console.log('PaginationPlus: onHeaderClick triggered')
          callbacks.onHeaderClick?.(params)
        },
        onFooterClick: (params: any) => {
          console.log('PaginationPlus: onFooterClick triggered')
          callbacks.onFooterClick?.(params)
        }
      })
    ],
    editorProps: {
      attributes: {
        class: 'prosa-document',
        spellcheck: 'true'
      },
      handlePaste: (view, event) => {
        const files = imageFilesFrom(event.clipboardData)
        if (files.length === 0) return false
        for (const file of files) void insertImageFile(view, file)
        return true
      },
      handleDrop: (view, event) => {
        const files = imageFilesFrom((event as DragEvent).dataTransfer)
        if (files.length === 0) return false
        const coords = { left: (event as DragEvent).clientX, top: (event as DragEvent).clientY }
        const pos = view.posAtCoords(coords)?.pos
        for (const file of files) void insertImageFile(view, file, pos)
        return true
      }
    },
    onUpdate: ({ editor }) => callbacks.onUpdate(editor),
    onSelectionUpdate: ({ editor }) => callbacks.onSelectionUpdate(editor)
  })
}

/** Extrai os arquivos de imagem de um DataTransfer (colar/arrastar). */
function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  return Array.from(data.files).filter((file) => file.type.startsWith('image/'))
}

/** Lê um arquivo de imagem como data URL (base64). */
function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Insere uma imagem (como data URL embutido) no documento, na posição
 * indicada ou na seleção atual.
 */
export async function insertImageFile(
  view: import('@tiptap/pm/view').EditorView,
  file: File,
  pos?: number
): Promise<void> {
  const src = await readImageAsDataUrl(file)
  const node = view.state.schema.nodes.image?.create({ src })
  if (!node) return
  const at = pos ?? view.state.selection.from
  view.dispatch(view.state.tr.insert(at, node))
}
