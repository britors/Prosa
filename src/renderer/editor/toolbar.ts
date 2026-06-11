// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Editor } from '@tiptap/core'
import { setAppTheme } from '../components/theme-selector.js'
import { getIcon } from '../utils/icons.js'

/** Fontes padrão exibidas até as fontes do sistema serem carregadas. */
const DEFAULT_FONTS = ['Inter', 'Georgia', 'Times New Roman', 'Arial', 'Courier New']

/** Tamanhos de fonte disponíveis (em pt). */
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]

/** Controlador retornado por createToolbar para atualizações posteriores. */
export interface ToolbarController {
  /** Atualiza os estados ativos dos botões conforme a seleção. */
  updateActiveStates: () => void
  /** Substitui a lista de fontes do seletor (ex.: fontes do sistema). */
  setFonts: (fonts: string[]) => void
}

/** Escapa um valor para uso seguro em atributo HTML. */
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Descrição de um botão da barra de ferramentas. */
interface ToolButton {
  icon: string
  title: string
  command: (editor: Editor) => void
  isActive?: (editor: Editor) => boolean
}

/** Cria um elemento de botão com ícone Lucide. */
async function createButton(def: ToolButton, editor: Editor): Promise<HTMLButtonElement> {
  const button = document.createElement('button')
  button.className = 'toolbar-btn'
  button.title = def.title
  button.innerHTML = await getIcon(def.icon)
  button.addEventListener('click', () => {
    def.command(editor)
    editor.view.focus()
  })
  button.dataset.active = 'false'
  return button
}

/** Cria um separador visual entre grupos de botões. */
function createSeparator(): HTMLSpanElement {
  const sep = document.createElement('span')
  sep.className = 'toolbar-sep'
  return sep
}

/**
 * Monta a barra de ferramentas de formatação e devolve uma função para
 * atualizar os estados ativos conforme a seleção do editor.
 */
export async function createToolbar(
  container: HTMLElement,
  editor: Editor,
  handlers: { onFind: () => void; onPrint: () => void; onInsertImage: () => void }
): Promise<ToolbarController> {
  const buttons: { el: HTMLButtonElement; def: ToolButton }[] = []
  // Lista atual de fontes do seletor (substituída pelas fontes do sistema).
  let fontFamilies = [...DEFAULT_FONTS]

  const addGroup = async (defs: ToolButton[]): Promise<void> => {
    for (const def of defs) {
      const el = await createButton(def, editor)
      container.appendChild(el)
      buttons.push({ el, def })
    }
    container.appendChild(createSeparator())
  }

  // Desfazer / Refazer
  await addGroup([
    {
      icon: 'undo',
      title: 'Desfazer (Ctrl+Z)',
      command: (e) => e.chain().focus().undo().run()
    },
    {
      icon: 'redo',
      title: 'Refazer (Ctrl+Y)',
      command: (e) => e.chain().focus().redo().run()
    }
  ])

  // Família e tamanho de fonte
  const fontSelect = document.createElement('select')
  fontSelect.className = 'toolbar-select'
  fontSelect.title = 'Família da fonte'

  /** Reconstrói as opções do seletor a partir da lista de fontes atual. */
  const renderFontOptions = (): void => {
    const current = fontSelect.value
    fontSelect.innerHTML =
      '<option value="">Fonte</option>' +
      fontFamilies
        .map((f) => {
          const safe = escapeAttr(f)
          return `<option value="${safe}" style="font-family: ${safe}">${safe}</option>`
        })
        .join('')
    fontSelect.value = current
  }
  renderFontOptions()

  fontSelect.addEventListener('change', () => {
    if (fontSelect.value) {
      editor.chain().focus().setFontFamily(fontSelect.value).run()
    } else {
      editor.chain().focus().unsetFontFamily().run()
    }
  })
  container.appendChild(fontSelect)

  const sizeSelect = document.createElement('select')
  sizeSelect.className = 'toolbar-select toolbar-select-sm'
  sizeSelect.title = 'Tamanho da fonte'
  sizeSelect.innerHTML =
    '<option value="">pt</option>' +
    FONT_SIZES.map((s) => `<option value="${s}">${s}</option>`).join('')
  sizeSelect.addEventListener('change', () => {
    if (sizeSelect.value) {
      editor.chain().focus().setFontSize(`${sizeSelect.value}pt`).run()
    } else {
      editor.chain().focus().unsetFontSize().run()
    }
  })
  container.appendChild(sizeSelect)
  container.appendChild(createSeparator())

  // Marcas inline
  await addGroup([
    {
      icon: 'bold',
      title: 'Negrito (Ctrl+B)',
      command: (e) => e.chain().focus().toggleBold().run(),
      isActive: (e) => e.isActive('bold')
    },
    {
      icon: 'italic',
      title: 'Itálico (Ctrl+I)',
      command: (e) => e.chain().focus().toggleItalic().run(),
      isActive: (e) => e.isActive('italic')
    },
    {
      icon: 'underline',
      title: 'Sublinhado (Ctrl+U)',
      command: (e) => e.chain().focus().toggleUnderline().run(),
      isActive: (e) => e.isActive('underline')
    },
    {
      icon: 'strikethrough',
      title: 'Tachado',
      command: (e) => e.chain().focus().toggleStrike().run(),
      isActive: (e) => e.isActive('strike')
    },
    {
      icon: 'superscript',
      title: 'Sobrescrito',
      command: (e) => e.chain().focus().toggleSuperscript().run(),
      isActive: (e) => e.isActive('superscript')
    },
    {
      icon: 'subscript',
      title: 'Subscrito',
      command: (e) => e.chain().focus().toggleSubscript().run(),
      isActive: (e) => e.isActive('subscript')
    }
  ])

  // Títulos e parágrafo
  await addGroup([
    {
      icon: 'heading-1',
      title: 'Título 1',
      command: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: (e) => e.isActive('heading', { level: 1 })
    },
    {
      icon: 'heading-2',
      title: 'Título 2',
      command: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: (e) => e.isActive('heading', { level: 2 })
    },
    {
      icon: 'heading-3',
      title: 'Título 3',
      command: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: (e) => e.isActive('heading', { level: 3 })
    },
    {
      icon: 'pilcrow',
      title: 'Parágrafo',
      command: (e) => e.chain().focus().setParagraph().run(),
      isActive: (e) => e.isActive('paragraph')
    }
  ])

  // Alinhamento
  await addGroup([
    {
      icon: 'align-left',
      title: 'Alinhar à esquerda',
      command: (e) => e.chain().focus().setTextAlign('left').run(),
      isActive: (e) => e.isActive({ textAlign: 'left' })
    },
    {
      icon: 'align-center',
      title: 'Centralizar',
      command: (e) => e.chain().focus().setTextAlign('center').run(),
      isActive: (e) => e.isActive({ textAlign: 'center' })
    },
    {
      icon: 'align-right',
      title: 'Alinhar à direita',
      command: (e) => e.chain().focus().setTextAlign('right').run(),
      isActive: (e) => e.isActive({ textAlign: 'right' })
    },
    {
      icon: 'align-justify',
      title: 'Justificar',
      command: (e) => e.chain().focus().setTextAlign('justify').run(),
      isActive: (e) => e.isActive({ textAlign: 'justify' })
    }
  ])

  // Listas
  await addGroup([
    {
      icon: 'list',
      title: 'Lista não ordenada',
      command: (e) => e.chain().focus().toggleBulletList().run(),
      isActive: (e) => e.isActive('bulletList')
    },
    {
      icon: 'list-ordered',
      title: 'Lista ordenada',
      command: (e) => e.chain().focus().toggleOrderedList().run(),
      isActive: (e) => e.isActive('orderedList')
    },
    {
      icon: 'list-todo',
      title: 'Lista de tarefas',
      command: (e) => e.chain().focus().toggleTaskList().run(),
      isActive: (e) => e.isActive('taskList')
    }
  ])

  // Inserções
  await addGroup([
    {
      icon: 'link',
      title: 'Inserir link',
      command: (e) => {
        const url = window.prompt('URL do link:')
        if (url) e.chain().focus().setLink({ href: url }).run()
      },
      isActive: (e) => e.isActive('link')
    },
    {
      icon: 'image',
      title: 'Inserir imagem (arquivo)',
      command: () => handlers.onInsertImage()
    },
    {
      icon: 'table',
      title: 'Inserir tabela',
      command: (e) =>
        e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    },
    {
      icon: 'scissors',
      title: 'Quebra de página',
      command: (e) => e.chain().focus().setPageBreak().run()
    }
  ])

  // Cor e destaque
  const colorInput = document.createElement('input')
  colorInput.type = 'color'
  colorInput.className = 'toolbar-color'
  colorInput.title = 'Cor do texto'
  colorInput.value = '#06b6d4'
  colorInput.addEventListener('input', () => {
    editor.chain().focus().setColor(colorInput.value).run()
  })
  container.appendChild(colorInput)

  const highlightBtn = await createButton(
    {
      icon: 'highlighter',
      title: 'Realçar',
      command: (e) => e.chain().focus().toggleHighlight().run(),
      isActive: (e) => e.isActive('highlight')
    },
    editor
  )
  container.appendChild(highlightBtn)
  buttons.push({
    el: highlightBtn,
    def: {
      icon: 'highlighter',
      title: 'Realçar',
      command: (e) => e.chain().focus().toggleHighlight().run(),
      isActive: (e) => e.isActive('highlight')
    }
  })
  container.appendChild(createSeparator())

  // Localizar
  const findBtn = document.createElement('button')
  findBtn.className = 'toolbar-btn'
  findBtn.title = 'Localizar (Ctrl+F)'
  findBtn.innerHTML = await getIcon('search')
  findBtn.addEventListener('click', handlers.onFind)
  container.appendChild(findBtn)

  // Imprimir
  const printBtn = document.createElement('button')
  printBtn.className = 'toolbar-btn'
  printBtn.title = 'Imprimir (Ctrl+P)'
  printBtn.innerHTML = await getIcon('printer')
  printBtn.addEventListener('click', handlers.onPrint)
  container.appendChild(printBtn)

  // Alternar tema
  const themeBtn = document.createElement('button')
  themeBtn.className = 'toolbar-btn'
  themeBtn.title = 'Alternar tema (Claro/Escuro)'
  let isDark = document.documentElement.getAttribute('data-theme') !== 'light'
  themeBtn.innerHTML = await getIcon(isDark ? 'sun' : 'moon')
  themeBtn.addEventListener('click', () => {
    isDark = !isDark
    setAppTheme(isDark)
    // Atualiza ícone dinamicamente
    void getIcon(isDark ? 'sun' : 'moon').then(icon => themeBtn.innerHTML = icon)
  })
  container.appendChild(themeBtn)

  /** Atualiza o estado visual dos botões conforme a seleção atual. */
  const updateActiveStates = (): void => {
    for (const { el, def } of buttons) {
      if (def.isActive) {
        el.dataset.active = String(def.isActive(editor))
      }
    }
    const fontFamily = (editor.getAttributes('textStyle').fontFamily as string) ?? ''
    // Se a fonte aplicada não estiver na lista, inclui-a para refletir a seleção.
    if (fontFamily && !fontFamilies.includes(fontFamily)) {
      fontFamilies = [fontFamily, ...fontFamilies]
      renderFontOptions()
    }
    fontSelect.value = fontFamily
    const fontSize = (editor.getAttributes('textStyle').fontSize as string) ?? ''
    const sizeNum = fontSize.replace('pt', '')
    sizeSelect.value = FONT_SIZES.map(String).includes(sizeNum) ? sizeNum : ''
  }

  /** Substitui a lista de fontes do seletor (ex.: fontes do sistema). */
  const setFonts = (fonts: string[]): void => {
    if (fonts.length > 0) {
      fontFamilies = fonts
      renderFontOptions()
    }
  }

  return { updateActiveStates, setFonts }
}
