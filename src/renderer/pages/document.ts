// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { Color } from '@tiptap/extension-color'
import { FontFamily } from '@tiptap/extension-font-family'
import { FontSize } from '../editor/extensions/font-size.js'
import { Editor, type Editor as EditorType } from '@tiptap/core'
import { createEditor, insertImageFile } from '../editor/editor.js'
import StarterKit from '@tiptap/starter-kit'
import { Image } from '@tiptap/extension-image'
import { createToolbar } from '../editor/toolbar.js'
import { CommandPalette } from './command-palette.js'
import { CitationManager } from '../components/citation-manager.js'
import { GraphView } from '../components/graph-view.js'
import { SidebarOutline } from '../components/sidebar-outline.js'
import { StylesPanel } from '../components/styles-panel.js'
import { FindReplacePanel } from '../components/find-replace.js'
import { WordCountBar } from '../components/word-count-bar.js'
import { applyDocumentTheme } from '../components/theme-selector.js'
import { FormatDialog } from '../components/format-dialog.js'
import { TemplateDialog } from '../components/template-dialog.js'
import { SearchModal } from '../components/search-modal.js'
import { documentText } from '../../shared/document-utils.js'
import type {
  FileFormat,
  OpenedDocument,
  ProsaSettings,
  SavePayload,
  TipTapJSON
} from '../../shared/types.js'

/** Limites de zoom da área de edição. */
const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 10

/** Formatos em que o Prosa consegue gravar. */
const WRITABLE_FORMATS = new Set<FileFormat>(['prosa', 'docx', 'odt', 'rtf', 'md', 'txt'])

/** Elementos do DOM necessários para a vista de documento. */
export interface DocumentViewElements {
  root: HTMLElement
  toolbar: HTMLElement
  hRuler: HTMLElement
  vRuler: HTMLElement
  /** Pilha que envolve cabeçalho + editor + rodapé (recebe o zoom). */
  page: HTMLElement
  editorHost: HTMLElement
  outline: HTMLElement
  styles: HTMLElement
  statusBar: HTMLElement
}

/**
 * Controlador da vista de edição. Cria o editor, conecta a barra de
 * ferramentas, painéis, busca e barra de status, e cuida do estado
 * "sujo" (não salvo) e do ciclo de salvar/abrir.
 */
export class DocumentView {
  readonly editor: EditorType
  private readonly els: DocumentViewElements
  private readonly outline: SidebarOutline
  private readonly styles: StylesPanel
  private readonly findReplace: FindReplacePanel
  private readonly commandPalette: CommandPalette
  private readonly citationManager: CitationManager
  private readonly graphView: GraphView
  private readonly statusBar: WordCountBar
  private readonly formatDialog: FormatDialog
  private readonly templateDialog: TemplateDialog
  private updateToolbar: () => void = () => {}

  private currentPath: string | null = null
  private currentFormat: FileFormat | null = null
  private documentName = 'Sem título'
  private dirty = false
  private zoom: number
  private autoSaveTimer: number | null = null
  private settings: ProsaSettings
  private headerHTML = ''
  private footerHTML = ''
  private typewriterMode = false

  constructor(els: DocumentViewElements, settings: ProsaSettings, searchModal: SearchModal) {
    this.els = els
    this.settings = settings
    this.zoom = settings.zoom

    this.editor = createEditor(els.editorHost, {
      onUpdate: () => this.handleUpdate(),
      onSelectionUpdate: () => {
        this.handleSelectionUpdate()
        if (this.typewriterMode) this.centerCursor()
      },
      onMatchesUpdate: (current, total) =>
        this.findReplace.updateCounter(current, total),
      onHeaderClick: (params) => this.promptHeader(params),
      onFooterClick: (params) => this.promptFooter(params)
    })
    this.formatDialog = new FormatDialog(els.root)
    this.templateDialog = new TemplateDialog(els.root)

    this.findReplace = new FindReplacePanel(els.toolbar.parentElement ?? els.root, this.editor)
    this.commandPalette = new CommandPalette(els.root, this.editor, (path) => {
        void window.prosa.openDocument(path).then(res => {
            if (res.ok && res.document) this.load(res.document)
        })
    }, () => this.toggleTypewriterMode(), () => this.dailyNote(), () => this.citationManager.show(), () => this.graphView.show(), () => void this.templateDialog.choose(), () => searchModal.show())


    
    this.citationManager = new CitationManager(els.root, this.editor)
    this.graphView = new GraphView(els.root)
    
    // Agora createToolbar é assíncrono
    void createToolbar(els.toolbar, this.editor, {
      onFind: () => this.findReplace.show(false),
      onPrint: () => void window.prosa.print(),
      onInsertImage: () => this.openImagePicker(),
      onInsertLink: () => this.promptLink()
    }).then((toolbar) => {
        this.updateToolbar = toolbar.updateActiveStates
        // Carrega as fontes instaladas no sistema e popula o seletor.
        void window.prosa.getSystemFonts().then((fonts) => toolbar.setFonts(fonts))
    })

    this.outline = new SidebarOutline(els.outline, this.editor)
    this.styles = new StylesPanel(els.styles, this.editor)
    this.statusBar = new WordCountBar(els.statusBar, this.editor)
    this.formatDialog = new FormatDialog(els.root)

    // Força o estado oculto padrão para os painéis laterais
    els.outline.parentElement?.setAttribute('hidden', '')
    els.styles.parentElement?.setAttribute('hidden', '')

    this.applySettings()
    
    // #8: Tipografia Adaptativa
    new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width
      this.els.editorHost.style.fontSize = width < 800 ? '14px' : '16px'
    }).observe(this.els.editorHost)

    // #9: Interface Modular (Drag and Drop para painéis)
    const panels = [els.outline.parentElement, els.styles.parentElement]
    panels.forEach(panel => {
      if (panel) {
        panel.draggable = true
        panel.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', panel.id))
      }
    })

    this.refresh()
  }

  /** Centraliza o cursor verticalmente no editor (Typewriter Mode). */
  private centerCursor(): void {
    const { view } = this.editor
    const { state } = view
    const { selection } = state
    const coords = view.coordsAtPos(selection.anchor)
    
    const container = this.els.editorHost
    const containerRect = container.getBoundingClientRect()
    const scrollTop = container.scrollTop
    
    const cursorYRelativeToContainer = coords.top - containerRect.top + scrollTop
    const targetScrollTop = cursorYRelativeToContainer - containerRect.height / 2
    
    container.scrollTo({ top: targetScrollTop, behavior: 'smooth' })
  }

  /** Alterna o modo máquina de escrever. */
  toggleTypewriterMode(): void {
    this.typewriterMode = !this.typewriterMode
  }

  /** Cria ou abre o documento diário. */
  dailyNote(): void {
    const date = new Date().toISOString().split('T')[0]
    const name = `Daily-Notes-${date}.prosa`
    // No renderer, não temos acesso direto ao FS, precisamos delegar ao main
    void window.prosa.openDocument(name).then(res => {
        if (res.ok && res.document) this.load(res.document)
        else {
            this.newDocument()
            this.documentName = name
            this.statusBar.setDocumentName(name)
        }
    })
  }


  /** Atualiza o conteúdo repetido das bandas de paginação. */
  private updatePaginationBands(): void {
    // Sincroniza o conteúdo com o plugin de paginação para repetição em todas as páginas.
    this.editor.commands.updateHeaderContent(this.headerHTML, '')
    this.editor.commands.updateFooterContent(this.footerHTML, 'Página {page}')
  }
  /** Abre um prompt para inserir link. */
  private promptLink(): void {
    const event = new MouseEvent('click', { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 })
    this.customPrompt('URL do link:', '', event, (url) => {
        if (url) this.editor.chain().focus().setLink({ href: url }).run()
    })
  }

  /** Abre um prompt para editar o cabeçalho. */
  private promptHeader(params: { event: MouseEvent }): void {
    console.log('promptHeader');
    this.customPrompt('Editar cabeçalho:', this.headerHTML, params.event, (val) => {
      this.headerHTML = val
      this.updatePaginationBands()
      this.setDirty(true)
    }, true)
  }

  /** Abre um prompt para editar o rodapé. */
  private promptFooter(params: { event: MouseEvent }): void {
    console.log('promptFooter');
    this.customPrompt('Editar rodapé:', this.footerHTML, params.event, (val) => {
      this.footerHTML = val
      this.updatePaginationBands()
      this.setDirty(true)
    }, true)
  }

/** 
 * Implementação de um prompt customizado inline.
 */
private customPrompt(title: string, defaultValue: string, event: MouseEvent, callback: (val: string) => void, richText: boolean = false): void {
  console.log('DEBUG: customPrompt called with richText:', richText)
  const editorDom = this.editor.view.dom
  editorDom.classList.add('is-editing')

  const menu = document.createElement('div')
  menu.className = 'floating-editor'

  // Posiciona perto do clique
  menu.style.top = `${event.clientY + 10}px`
  menu.style.left = `${event.clientX}px`

    menu.innerHTML = `
      <div class="prompt-title">${title}</div>
      <div class="mini-toolbar">
        <button class="btn-tool" id="bold" title="Negrito"><b>B</b></button>
        <button class="btn-tool" id="italic" title="Itálico"><i>I</i></button>
        <input type="color" id="color" title="Cor">
        <input type="number" id="size" title="Tamanho (px)" min="8" max="72" value="12">
        <button class="btn-tool" id="image" title="Imagem">🖼️</button>
      </div>
      <div class="mini-editor-container"></div>
      <div class="prompt-actions">
        <button class="btn btn-cancel">Cancelar</button>
        <button class="btn btn-primary btn-save">OK</button>
      </div>
    `

    const container = menu.querySelector('.mini-editor-container') as HTMLElement
    const btnSave = menu.querySelector('.btn-save') as HTMLButtonElement
    const btnCancel = menu.querySelector('.btn-cancel') as HTMLButtonElement

    let miniEditor: Editor | null = null

    if (richText) {
        miniEditor = new Editor({
            element: container,
            extensions: [StarterKit, Image, Color, FontFamily, FontSize],
            content: defaultValue
        })

        menu.querySelector('#bold')?.addEventListener('click', () => miniEditor?.chain().focus().toggleBold().run())
        menu.querySelector('#italic')?.addEventListener('click', () => miniEditor?.chain().focus().toggleItalic().run())
        menu.querySelector('#color')?.addEventListener('input', (e) => miniEditor?.chain().focus().setColor((e.target as HTMLInputElement).value).run())
        menu.querySelector('#size')?.addEventListener('input', (e) => miniEditor?.chain().focus().setFontSize((e.target as HTMLInputElement).value + 'px').run())
        menu.querySelector('#image')?.addEventListener('click', () => {
             const input = document.createElement('input')
             input.type = 'file'
             input.accept = 'image/*'
             input.onchange = () => {
                 if (input.files?.[0]) {
                     const reader = new FileReader()
                     reader.onload = (e) => miniEditor?.chain().focus().setImage({ src: e.target?.result as string }).run()
                     reader.readAsDataURL(input.files[0])
                 }
             }
             input.click()
        })
    } else {
        container.innerHTML = `<input type="text" class="floating-input" value="${defaultValue.replace(/"/g, '&quot;')}" spellcheck="false">`
    }

    const close = () => {
        try {
            miniEditor?.destroy()
            menu.remove()
        } finally {
            editorDom.classList.remove('is-editing')
        }
    }

    btnSave.onclick = () => {
        const val = richText ? miniEditor?.getHTML() ?? '' : (menu.querySelector('input') as HTMLInputElement).value
        callback(val)
        close()
    }
    btnCancel.onclick = close

  menu.onclick = (e) => {
    if (e.target === menu) close()
  }

  document.body.appendChild(menu)
  setTimeout(() => {
      if (richText) miniEditor?.commands.focus()
      else (menu.querySelector('input') as HTMLInputElement)?.focus()
  }, 10)
}

  /** Aplica configurações iniciais (zoom, fonte, tema, visibilidade). */
  private applySettings(): void {
    applyDocumentTheme(this.els.editorHost, 'serif')
    this.setZoom(this.zoom)
    // Força o estado oculto padrão, ignorando a configuração do usuário para o outline.
    this.els.outline.parentElement?.setAttribute('hidden', '')
    this.els.statusBar.toggleAttribute('hidden', !this.settings.showWordCount)
  }

  /** Trata atualizações de conteúdo: marca como sujo e atualiza painéis. */
  private handleUpdate(): void {
    this.setDirty(true)
    this.refresh()
    this.scheduleAutoSave()
  }

  /** Trata mudanças de seleção: atualiza estados ativos. */
  private handleSelectionUpdate(): void {
    if (this.updateToolbar) this.updateToolbar()
    this.styles.update()
    this.statusBar.update()
  }

  /** Reconstrói outline, estilos e barra de status. */
  private refresh(): void {
    this.outline.update()
    this.styles.update()
    if (this.updateToolbar) this.updateToolbar()
    this.statusBar.update()
  }

  /** Define o estado de alterações não salvas e notifica o main. */
  private setDirty(dirty: boolean): void {
    if (this.dirty === dirty) return
    this.dirty = dirty
    this.statusBar.setDirty(dirty)
    window.prosa.notifyDirty(dirty)
  }

  /** Agenda um auto-save respeitando o intervalo das configurações. */
  private scheduleAutoSave(): void {
    if (!this.settings.autoSave || !this.currentPath) return
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer)
    }
    this.autoSaveTimer = window.setTimeout(() => {
      void this.save(false)
    }, this.settings.autoSaveInterval * 1000)
  }

  /** Cria um documento em branco. */
  newDocument(): void {
    this.editor.commands.clearContent()
    this.headerHTML = ''
    this.footerHTML = ''
    this.currentPath = null
    this.currentFormat = null
    this.documentName = 'Sem título'
    this.statusBar.setDocumentName(this.documentName)
    this.updatePaginationBands()
    this.setDirty(false)
    this.refresh()
    this.editor.commands.focus()
  }

  /** Carrega um documento aberto no editor. */
  load(doc: OpenedDocument): void {
    this.editor.commands.setContent(doc.html, false)
    this.headerHTML = doc.header ?? ''
    this.footerHTML = doc.footer ?? ''
    this.currentPath = doc.path
    this.currentFormat = doc.format
    this.documentName = doc.name
    this.statusBar.setDocumentName(doc.name)
    this.updatePaginationBands()
    this.setDirty(false)
    this.refresh()
  }

  /** Monta o payload de salvamento a partir do estado atual do editor. */
  private buildPayload(): SavePayload {
    const json = this.editor.getJSON() as TipTapJSON
    const now = new Date().toISOString()
    return {
      path: this.currentPath,
      html: this.editor.getHTML(),
      json,
      text: documentText(json),
      header: this.headerHTML,
      footer: this.footerHTML,
      metadata: {
        title: this.documentName.replace(/\.[^.]+$/, ''),
        author: '',
        createdAt: now,
        modifiedAt: now
      }
    }
  }

  /**
   * Salva o documento. Em "Salvar como", no primeiro salvamento, ou quando a
   * origem é somente leitura (.doc/.pdf), exibe o seletor de formato para o
   * usuário escolher; um "Salvar" comum reutiliza o formato atual sem
   * perguntar.
   */
  async save(forceDialog: boolean): Promise<void> {
    const sourceReadOnly =
      this.currentFormat !== null && !WRITABLE_FORMATS.has(this.currentFormat)
    const asDialog = forceDialog || sourceReadOnly
    const needsFormat = asDialog || !this.currentPath

    let chosenFormat: FileFormat | undefined
    if (needsFormat) {
      const preset =
        this.currentFormat && WRITABLE_FORMATS.has(this.currentFormat)
          ? this.currentFormat
          : 'prosa'
      const picked = await this.formatDialog.choose(preset)
      if (!picked) return // usuário cancelou
      chosenFormat = picked
    }

    const payload = this.buildPayload()
    if (chosenFormat) payload.format = chosenFormat

    const result = asDialog
      ? await window.prosa.saveDocumentAs(payload)
      : await window.prosa.saveDocument(payload)

    if (result.ok && result.path) {
      this.currentPath = result.path
      if (chosenFormat) this.currentFormat = chosenFormat
      this.documentName = result.path.split(/[\\/]/).pop() ?? this.documentName
      this.statusBar.setDocumentName(this.documentName)
      this.setDirty(false)
    } else if (result.error) {
      window.alert(`Erro ao salvar: ${result.error}`)
    }
  }

  /** Exporta o documento atual para PDF. */
  async exportPdf(): Promise<void> {
    const name = this.documentName.replace(/\.[^.]+$/, '')
    const result = await window.prosa.exportPdf(name)
    if (result.error) {
      window.alert(`Erro ao exportar PDF: ${result.error}`)
    }
  }

  /** Abre o seletor de arquivos para inserir uma imagem no documento. */
  openImagePicker(): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? [])
      for (const file of files) {
        void insertImageFile(this.editor.view, file)
      }
    })
    input.click()
  }

  /** Abre o painel de Localizar (ou Localizar & Substituir). */
  openFind(withReplace: boolean): void {
    this.findReplace.show(withReplace)
  }

  /** Abre a Paleta de Comandos. */
  openCommandPalette(): void {
    this.commandPalette.show()
  }

  /** Alterna o workspace do projeto. */
  async switchWorkspace(): Promise<void> {
    const path = await window.prosa.selectDirectory()
    if (path) {
        window.prosa.setSettings({ workspacePath: path })
        window.location.reload()
    }
  }

  /** Define o nível de zoom da área de edição. */
  setZoom(zoom: number): void {
    this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
    this.els.page.style.setProperty('--editor-zoom', String(this.zoom / 100))
    this.statusBar.setZoom(this.zoom)
    void window.prosa.setSettings({ zoom: this.zoom })
  }

  /** Amplia o zoom. */
  zoomIn(): void {
    this.setZoom(this.zoom + ZOOM_STEP)
  }

  /** Reduz o zoom. */
  zoomOut(): void {
    this.setZoom(this.zoom - ZOOM_STEP)
  }

  /** Restaura o zoom para 100%. */
  zoomReset(): void {
    this.setZoom(100)
  }

  /** Alterna a visibilidade do painel de tópicos. */
  toggleOutline(): void {
    const panel = this.els.outline.parentElement
    panel?.toggleAttribute('hidden')
  }

  /** Alterna a visibilidade do painel de estilos. */
  toggleStyles(): void {
    const panel = this.els.styles.parentElement
    panel?.toggleAttribute('hidden')
  }

  /** Alterna a visibilidade da barra de contagem de palavras. */
  toggleWordCount(): void {
    this.els.statusBar.toggleAttribute('hidden')
  }

  /** Indica se há alterações não salvas. */
  get isDirty(): boolean {
    return this.dirty
  }
}
