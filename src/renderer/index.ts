// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { DocumentView, type DocumentViewElements } from './pages/document.js'
import { WelcomeScreen } from './pages/welcome.js'
import { applyTheme } from './components/theme-engine.js'
import { setAppTheme } from './components/theme-selector.js'
import type { AppInfo, OpenedDocument } from '../shared/types.js'

/** Localiza um elemento obrigatório no DOM. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Elemento #${id} não encontrado`)
  return node as T
}

/** Ponto de entrada do renderer: inicializa a aplicação. */
async function bootstrap(): Promise<void> {
  const settings = await window.prosa.getSettings()
  if (settings.palette) {
    applyTheme(settings.palette)
  } else {
    setAppTheme(settings.theme !== 'light')
  }

  const elements: DocumentViewElements = {
    root: el('document-view'),
    toolbar: el('toolbar'),
    page: el('page-stack'),
    editorHost: el('editor'),
    outline: el('outline'),
    styles: el('styles'),
    statusBar: el('status-bar')
  }

  const view = new DocumentView(elements, settings)
  const welcomeRoot = el('welcome-view')

  /** Mostra a vista de edição e oculta a tela de boas-vindas. */
  const showEditor = (): void => {
    welcome.hide()
    elements.root.hidden = false
  }

  /** Mostra a tela de boas-vindas com a lista atual de recentes. */
  const showWelcome = async (): Promise<void> => {
    const recent = await window.prosa.getRecentFiles()
    welcome.render(recent)
    elements.root.hidden = true
    welcome.show()
  }

  const welcome = new WelcomeScreen(welcomeRoot, {
    onNew: () => {
      view.newDocument()
      showEditor()
    },
    onOpen: () => void openViaDialog(),
    onOpenRecent: (path) => void openPath(path)
  })

  /** Abre um arquivo a partir de um caminho conhecido. */
  const openPath = async (path: string): Promise<void> => {
    const result = await window.prosa.openDocument(path)
    if (result.ok && result.document) {
      view.load(result.document)
      showEditor()
    } else if (result.error) {
      window.alert(`Não foi possível abrir: ${result.error}`)
    }
  }

  /** Abre um arquivo via diálogo do sistema. */
  const openViaDialog = async (): Promise<void> => {
    const result = await window.prosa.openDocument()
    if (result.ok && result.document) {
      view.load(result.document)
      showEditor()
    }
  }

  registerMenuActions(view, showEditor, showWelcome, openViaDialog)
  registerDragAndDrop(openPath)

  await showWelcome()
}

/** Liga as ações de menu enviadas pelo processo main. */
function registerMenuActions(
  view: DocumentView,
  showEditor: () => void,
  showWelcome: () => Promise<void>,
  openViaDialog: () => Promise<void>
): void {
  const editor = view.editor

  window.prosa.onMenuAction((action, payload) => {
    switch (action) {
      case 'document:loaded':
        view.load(payload as OpenedDocument)
        showEditor()
        break
      case 'file:new':
        view.newDocument()
        showEditor()
        break
      case 'file:open':
        void openViaDialog()
        break
      case 'file:save':
        void view.save(false)
        break
      case 'file:saveAs':
        void view.save(true)
        break
      case 'file:exportPdf':
        void view.exportPdf()
        break
      case 'edit:find':
        view.openFind(false)
        break
      case 'edit:replace':
        view.openFind(true)
        break
      case 'edit:commandPalette':
        view.openCommandPalette()
        break
      case 'workspace:switch':
        void view.switchWorkspace()
        break
      case 'format:bold':
        editor.chain().focus().toggleBold().run()
        break
      case 'format:italic':
        editor.chain().focus().toggleItalic().run()
        break
      case 'format:underline':
        editor.chain().focus().toggleUnderline().run()
        break
      case 'format:strike':
        editor.chain().focus().toggleStrike().run()
        break
      case 'format:heading':
        editor.chain().focus().toggleHeading({ level: payload as 1 | 2 | 3 | 4 | 5 | 6 }).run()
        break
      case 'format:align':
        editor.chain().focus().setTextAlign(payload as string).run()
        break
      case 'format:bulletList':
        editor.chain().focus().toggleBulletList().run()
        break
      case 'format:orderedList':
        editor.chain().focus().toggleOrderedList().run()
        break
      case 'table:insert':
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        break
      case 'table:addRow':
        editor.chain().focus().addRowAfter().run()
        break
      case 'table:addColumn':
        editor.chain().focus().addColumnAfter().run()
        break
      case 'table:deleteRow':
        editor.chain().focus().deleteRow().run()
        break
      case 'table:deleteColumn':
        editor.chain().focus().deleteColumn().run()
        break
      case 'view:zoomIn':
        view.zoomIn()
        break
      case 'view:zoomOut':
        view.zoomOut()
        break
      case 'view:zoomReset':
        view.zoomReset()
        break
      case 'view:toggleOutline':
        view.toggleOutline()
        break
      case 'view:toggleStyles':
        view.toggleStyles()
        break
      case 'view:toggleWordCount':
        view.toggleWordCount()
        break
      case 'help:about':
        void showAbout()
        break
      default:
        break
    }
  })

  // Atalhos do renderer não cobertos pelo menu nativo.
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      view.openFind(false)
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
      event.preventDefault()
      view.openFind(true)
    }
  })

  void showWelcome // referência mantida para clareza da API
}

/** Habilita abrir arquivos por arrastar-e-soltar na janela. */
function registerDragAndDrop(openPath: (path: string) => Promise<void>): void {
  window.addEventListener('dragover', (event) => event.preventDefault())
  window.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined
    // Imagens soltas sobre o editor são tratadas pelo próprio editor (inserção);
    // aqui só abrimos documentos (não-imagens) arrastados para a janela.
    if (file && file.type.startsWith('image/')) {
      return
    }
    event.preventDefault()
    if (file?.path) {
      void openPath(file.path)
    }
  })
}

/** Exibe um diálogo simples "Sobre o Prosa". */
async function showAbout(): Promise<void> {
  const info: AppInfo = await window.prosa.getAppInfo()
  window.alert(
    `${info.name} ${info.version}\n` +
      `Licença: ${info.license}\n` +
      `${info.company}\n` +
      `${info.website}\n` +
      `Suporte: ${info.support}\n\n` +
      `${info.copyright}`
  )
}

document.addEventListener('DOMContentLoaded', () => {
  void bootstrap()
})
