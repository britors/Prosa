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
import { GraphView } from '../components/graph-view.js'
import { SidebarOutline } from '../components/sidebar-outline.js'
import { StylesPanel } from '../components/styles-panel.js'
import { FindReplacePanel } from '../components/find-replace.js'
import { WordCountBar } from '../components/word-count-bar.js'
import { FormatDialog } from '../components/format-dialog.js'
import { TemplateDialog } from '../components/template-dialog.js'
import { PluginDialog } from '../components/plugin-dialog.js'
import { VersionCompareDialog } from '../components/version-compare-dialog.js'
import { SyncNotification } from '../components/sync-notification.js'
import { FocusTimer } from '../components/focus-timer.js'
import { FontProfileDialog } from '../components/font-profile-dialog.js'
import { applyFontProfile, resolveFontProfile } from '../components/font-profiles.js'
import { FrontmatterDialog } from '../components/frontmatter-dialog.js'
import { BibliographyDialog } from '../components/bibliography-dialog.js'
import { HtmlExportDialog } from '../components/html-export-dialog.js'
import { PdfPresetDialog } from '../components/pdf-preset-dialog.js'
import { DocumentTemplateDialog } from '../components/document-template-dialog.js'
import { TocDialog } from '../components/toc-dialog.js'
import { AbntDialog, type AbntTemplateData } from '../components/abnt-dialog.js'
import { NotePanel } from '../components/note-panel.js'
import { WorkspaceRelationsPanel } from '../components/workspace-relations.js'
import { SearchModal } from '../components/search-modal.js'
import { WorkspaceLibraryDialog } from '../components/workspace-library.js'
import {
  AutoSaveController,
  DocumentPersistenceController,
  DirtyStateController,
  DistractionFreeController
} from './document-controllers.js'
import { formatBibliographyEntry } from '../../shared/bibliography.js'
import { extractCitations } from '../../shared/document-utils.js'
import { documentVariableToken, resolveDocumentVariables, type DocumentVariableName } from '../../shared/document-variables.js'
import type {
  BibliographyStyle,
  FileFormat,
  NoteEntry,
  NoteKind,
  OpenedDocument,
  ProsaSettings,
  TipTapJSON
} from '../../shared/types.js'

/** Limites de zoom da área de edição. */
const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 10

/** Formatos em que o Prosa consegue gravar. */
const WRITABLE_FORMATS = new Set<FileFormat>(['prosa', 'docx', 'odt', 'rtf', 'epub', 'md', 'txt'])

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

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
  notes: HTMLElement
  relations: HTMLElement
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
  private readonly bibliographyDialog: BibliographyDialog
  private readonly graphView: GraphView
  private readonly statusBar: WordCountBar
  private readonly formatDialog: FormatDialog
  private readonly templateDialog: TemplateDialog
  private readonly pluginDialog: PluginDialog
  private readonly versionCompareDialog: VersionCompareDialog
  private readonly syncNotification: SyncNotification
  private readonly focusTimer: FocusTimer
  private readonly fontProfileDialog: FontProfileDialog
  private readonly frontmatterDialog: FrontmatterDialog
  private readonly abntDialog: AbntDialog
  private readonly htmlExportDialog: HtmlExportDialog
  private readonly pdfPresetDialog: PdfPresetDialog
  private readonly documentTemplateDialog: DocumentTemplateDialog
  private readonly tocDialog: TocDialog
  private readonly notePanel: NotePanel
  private readonly workspaceRelationsPanel: WorkspaceRelationsPanel
  private readonly workspaceLibrary: WorkspaceLibraryDialog
  private readonly dirtyState: DirtyStateController
  private readonly autoSaveController: AutoSaveController
  private readonly distractionFreeController: DistractionFreeController
  private readonly persistenceController: DocumentPersistenceController
  private updateToolbar: () => void = () => {}

  private currentPath: string | null = null
  private currentFormat: FileFormat | null = null
  private documentName = 'Sem título'
  private zoom: number
  private settings: ProsaSettings
  private headerHTML = ''
  private footerHTML = ''
  private frontmatter: Record<string, string> = {}
  private notes: Record<string, NoteEntry> = {}
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
      onFooterClick: (params) => this.promptFooter(params),
      onMathEdit: (request) => this.customPrompt('Fórmula LaTeX:', request.latex, request.event, request.onSave)
    })
    this.formatDialog = new FormatDialog(els.root)
    this.templateDialog = new TemplateDialog(els.root)
    this.pluginDialog = new PluginDialog(els.root)
    this.versionCompareDialog = new VersionCompareDialog(els.root)
    this.syncNotification = new SyncNotification(els.root)
    this.fontProfileDialog = new FontProfileDialog(els.root)
    this.frontmatterDialog = new FrontmatterDialog(els.root)
    this.abntDialog = new AbntDialog(els.root)
    this.bibliographyDialog = new BibliographyDialog({
      onInsertCitation: (citeKey) => {
        this.editor.chain().focus().setCitation({ citeKey }).run()
      },
      onInsertBibliography: (style, keys) => this.insertBibliography(style, keys)
    }, els.root)
    this.htmlExportDialog = new HtmlExportDialog(els.root)
    this.pdfPresetDialog = new PdfPresetDialog(els.root)
    this.documentTemplateDialog = new DocumentTemplateDialog(els.root)
    this.tocDialog = new TocDialog(els.root)
    this.workspaceLibrary = new WorkspaceLibraryDialog({
      onOpenDocument: (path) => {
        void window.prosa.openDocument(path).then((res) => {
          if (res.ok && res.document) this.load(res.document)
        })
      },
      onCreateAbnt: () => this.createAbntDocument(),
      onInsertBibliography: (style, keys) => this.insertBibliography(style, keys)
    }, els.root)

    this.findReplace = new FindReplacePanel(els.toolbar.parentElement ?? els.root, this.editor)
    this.commandPalette = new CommandPalette(
      els.root,
      this.editor,
      (path) => {
        void window.prosa.openDocument(path).then((res) => {
          if (res.ok && res.document) this.load(res.document)
        })
      },
      () => this.toggleTypewriterMode(),
      () => this.toggleDistractionFree(),
      () => this.dailyNote(),
      () => void this.bibliographyDialog.show(),
      () => this.graphView.show(),
      () => void this.templateDialog.choose(),
      () => searchModal.show(),
      () => void this.pluginDialog.show(),
      () => void this.versionCompareDialog.show(this.currentPath, this.editor.getJSON() as TipTapJSON),
      () =>
        void this.fontProfileDialog.show(this.settings.activeFontProfileId, (profile) => {
          applyFontProfile(this.els.editorHost, profile)
          this.settings.activeFontProfileId = profile.id
          void window.prosa.setSettings({ activeFontProfileId: profile.id })
        }),
      () =>
        this.frontmatterDialog.show(this.frontmatter, (fm) => {
          this.frontmatter = fm
          this.setDirty(true)
        }),
      () => this.insertMathBlock(),
      (name) => this.insertDocumentVariable(name),
      () => void this.insertTableOfContents(),
      () => void this.showWorkspaceLibrary(),
      () => void this.createAbntDocument(),
      () => this.insertBibliography(),
      () => this.insertNote('footnote'),
      () => this.insertNote('endnote'),
      () => void this.exportHtml()
    )


    
    this.graphView = new GraphView(els.root)
    
    // Agora createToolbar é assíncrono
    void createToolbar(els.toolbar, this.editor, {
      onFind: () => this.findReplace.show(false),
      onPrint: () => void window.prosa.print(),
      onInsertImage: () => this.openImagePicker(),
      onInsertLink: () => this.promptLink(),
      onInsertFootnote: () => this.insertNote('footnote'),
      onInsertEndnote: () => this.insertNote('endnote')
    }).then((toolbar) => {
        this.updateToolbar = toolbar.updateActiveStates
        // Carrega as fontes instaladas no sistema e popula o seletor.
        void window.prosa.getSystemFonts().then((fonts) => toolbar.setFonts(fonts))
    })

    this.outline = new SidebarOutline(els.outline, this.editor)
    this.styles = new StylesPanel(els.styles, this.editor)
    this.focusTimer = new FocusTimer(settings.focusWorkMinutes, settings.focusBreakMinutes)
    this.statusBar = new WordCountBar(els.statusBar, this.editor, this.focusTimer.el)
    this.statusBar.setGoal(settings.wordGoal)
    this.notePanel = new NotePanel(els.notes, (id) => this.editNote(id), (id) => this.removeNote(id))
    this.workspaceRelationsPanel = new WorkspaceRelationsPanel(els.relations, {
      onOpenDocument: (path) => {
        void window.prosa.openDocument(path).then((res) => {
          if (res.ok && res.document) this.load(res.document)
        })
      }
    })

    this.dirtyState = new DirtyStateController(
      (dirty) => this.statusBar.setDirty(dirty),
      (dirty) => window.prosa.notifyDirty(dirty)
    )

    this.autoSaveController = new AutoSaveController(
      () => ({
        currentPath: this.currentPath,
        dirty: this.dirtyState.isDirty(),
        autoSavePolicy: this.settings.autoSavePolicy,
        autoSaveDebounceSeconds: this.settings.autoSaveDebounceSeconds
      }),
      async () => this.save(false)
    )

    this.distractionFreeController = new DistractionFreeController(
      {
        root: this.els.root,
        toolbar: this.els.toolbar,
        outlinePanel: this.els.outline.parentElement,
        stylesPanel: this.els.styles.parentElement,
        statusBar: this.els.statusBar
      },
      this.settings.distractionFree,
      (partial) => {
        this.settings = { ...this.settings, ...partial }
        void window.prosa.setSettings(partial)
      }
    )

    this.persistenceController = new DocumentPersistenceController(
      {
        getState: () => this.getPersistenceState(),
        setState: (state) => this.setPersistenceState(state),
        chooseFormat: async (preset) => this.formatDialog.choose(preset),
        choosePdfPreset: async (current) => this.pdfPresetDialog.choose(current),
        saveDocument: async (payload) => window.prosa.saveDocument(payload),
        saveDocumentAs: async (payload) => window.prosa.saveDocumentAs(payload),
        exportPdf: async (name, preset) => window.prosa.exportPdf(name, preset),
        exportEpub: async (name, payload) => window.prosa.exportEpub(name, payload),
        setDirty: (dirty) => this.setDirty(dirty),
        setDocumentName: (name) => this.statusBar.setDocumentName(name),
        setEditorContent: (html) => this.editor.commands.setContent(html, false),
        clearEditorContent: () => this.editor.commands.clearContent(),
        focusEditor: () => this.editor.commands.focus(),
        updatePaginationBands: () => this.updatePaginationBands(),
        refresh: () => this.refresh(),
        getPayloadData: () => ({
          html: this.editor.getHTML(),
          json: this.editor.getJSON() as TipTapJSON
        }),
        alertError: (message) => window.alert(message)
      },
      WRITABLE_FORMATS
    )

    this.applySettings()
    window.addEventListener('blur', () => this.autoSaveController.onWindowBlur())
    
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
            this.createBlankDocument()
            this.setPersistenceState({ ...this.getPersistenceState(), documentName: name })
            this.statusBar.setDocumentName(name)
        }
    })
  }

  private getPersistenceState(): {
    currentPath: string | null
    currentFormat: FileFormat | null
    documentName: string
    headerHTML: string
    footerHTML: string
    frontmatter: Record<string, string>
    notes: Record<string, NoteEntry>
  } {
    return {
      currentPath: this.currentPath,
      currentFormat: this.currentFormat,
      documentName: this.documentName,
      headerHTML: this.headerHTML,
      footerHTML: this.footerHTML,
      frontmatter: this.frontmatter,
      notes: this.notes
    }
  }

  private setPersistenceState(state: {
    currentPath: string | null
    currentFormat: FileFormat | null
    documentName: string
    headerHTML: string
    footerHTML: string
    frontmatter: Record<string, string>
    notes: Record<string, NoteEntry>
  }): void {
    this.currentPath = state.currentPath
    this.currentFormat = state.currentFormat
    this.documentName = state.documentName
    this.headerHTML = state.headerHTML
    this.footerHTML = state.footerHTML
    this.frontmatter = state.frontmatter
    this.notes = state.notes
  }


  /** Atualiza o conteúdo repetido das bandas de paginação. */
  private updatePaginationBands(): void {
    // Sincroniza o conteúdo com o plugin de paginação para repetição em todas as páginas.
    const context = this.documentVariableContext()
    this.editor.commands.updateHeaderContent(
      resolveDocumentVariables(this.headerHTML, context, { preservePaginationTokens: true }),
      ''
    )
    this.editor.commands.updateFooterContent(
      resolveDocumentVariables(this.footerHTML, context, { preservePaginationTokens: true }),
      'Página {page} de {total}'
    )
  }

  /** Contexto atual usado para resolver variáveis documentais. */
  private documentVariableContext(): { metadata: { title: string; author: string; createdAt: string; modifiedAt: string }; currentPath: string | null } {
    const now = new Date().toISOString()
    return {
      metadata: {
        title: this.documentName.replace(/\.[^.]+$/, '') || 'Documento',
        author: this.frontmatter.author ?? '',
        createdAt: now,
        modifiedAt: now
      },
      currentPath: this.currentPath
    }
  }

  /** Insere uma variável documental no documento atual como texto literal. */
  insertDocumentVariable(name: DocumentVariableName): void {
    this.editor.chain().focus().insertContent(documentVariableToken(name)).run()
  }

  /** Insere um bloco de sumário configurável no documento atual. */
  async insertTableOfContents(): Promise<void> {
    const toc = await this.tocDialog.choose()
    if (!toc) return
    this.editor.chain().focus().setTableOfContents(toc).run()
  }
  /** Abre um prompt para inserir link. */
  private promptLink(): void {
    const event = new MouseEvent('click', { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 })
    this.customPrompt('URL do link:', '', event, (url) => {
        if (!url) return
        if (url.startsWith('[[') && url.endsWith(']]')) {
          const target = url.slice(2, -2).trim()
          if (target) {
            this.editor.chain().focus().setWikilink({ href: `prosa://wiki/${encodeURIComponent(target)}` }).run()
          }
          return
        }
        this.editor.chain().focus().setLink({ href: url }).run()
    })
  }

  /** Insere uma nova nota e registra seu texto. */
  insertNote(kind: NoteKind): void {
    const event = new MouseEvent('click', { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 })
    this.customPrompt(kind === 'footnote' ? 'Texto da nota de rodapé:' : 'Texto da nota final:', '', event, (text) => {
      if (!text.trim()) return
      const id = crypto.randomUUID()
      this.notes = { ...this.notes, [id]: { id, kind, text } }
      this.editor.chain().focus().insertContent({ type: 'noteReference', attrs: { noteId: id, kind } }).run()
      this.setDirty(true)
      this.refresh()
    })
  }

  /** Edita uma nota existente. */
  editNote(id: string): void {
    const note = this.notes[id]
    if (!note) return
    const event = new MouseEvent('click', { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 })
    this.customPrompt(note.kind === 'footnote' ? 'Editar nota de rodapé:' : 'Editar nota final:', note.text, event, (text) => {
      this.notes = { ...this.notes, [id]: { ...note, text } }
      this.setDirty(true)
      this.refresh()
    })
  }

  /** Remove uma nota e as referências correspondentes no documento. */
  removeNote(id: string): void {
    if (!this.notes[id]) return
    const positions: { from: number; to: number }[] = []
    this.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'noteReference' && node.attrs.noteId === id) {
        positions.push({ from: pos, to: pos + node.nodeSize })
      }
    })
    const tr = this.editor.state.tr
    for (const range of positions.reverse()) {
      tr.delete(range.from, range.to)
    }
    this.editor.view.dispatch(tr)
    const next = { ...this.notes }
    delete next[id]
    this.notes = next
    this.setDirty(true)
    this.refresh()
  }

  /** Abre um prompt para inserir uma nova fórmula matemática. */
  insertMathBlock(): void {
    const event = new MouseEvent('click', { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 })
    this.customPrompt('Fórmula LaTeX:', '', event, (latex) => {
      if (latex) this.editor.chain().focus().insertContent({ type: 'mathBlock', attrs: { latex } }).run()
    })
  }

  /** Abre um prompt para editar o cabeçalho. */
  private promptHeader(params: { event: MouseEvent }): void {
    console.log('promptHeader');
    this.customPrompt('Editar cabeçalho:', this.headerHTML, params.event, (val) => {
      this.headerHTML = val
      this.updatePaginationBands()
      this.setDirty(true)
    }, true, true)
  }

  /** Abre um prompt para editar o rodapé. */
  private promptFooter(params: { event: MouseEvent }): void {
    console.log('promptFooter');
    this.customPrompt('Editar rodapé:', this.footerHTML, params.event, (val) => {
      this.footerHTML = val
      this.updatePaginationBands()
      this.setDirty(true)
    }, true, true)
  }

  /**
   * Implementação de um prompt customizado inline.
   */
  private customPrompt(
    title: string,
    defaultValue: string,
    event: MouseEvent,
    callback: (val: string) => void,
    richText = false,
    allowVariables = false
  ): void {
    const editorDom = this.editor.view.dom
    editorDom.classList.add('is-editing')

    const menu = document.createElement('div')
    menu.className = 'floating-editor'

    // Posiciona perto do clique
    menu.style.top = `${event.clientY + 10}px`
    menu.style.left = `${event.clientX}px`

    const variableToolbar = allowVariables
      ? `
      <div class="mini-toolbar mini-variables">
        <button class="btn-tool" data-variable="title" title="Título"><code>{{title}}</code></button>
        <button class="btn-tool" data-variable="author" title="Autor"><code>{{author}}</code></button>
        <button class="btn-tool" data-variable="date" title="Data"><code>{{date}}</code></button>
        <button class="btn-tool" data-variable="path" title="Arquivo"><code>{{path}}</code></button>
        <button class="btn-tool" data-variable="page" title="Página"><code>{{page}}</code></button>
        <button class="btn-tool" data-variable="total" title="Total"><code>{{total}}</code></button>
      </div>`
      : ''

    menu.innerHTML = `
      <div class="prompt-title">${title}</div>
      ${richText ? `
      <div class="mini-toolbar">
        <button class="btn-tool" id="bold" title="Negrito"><b>B</b></button>
        <button class="btn-tool" id="italic" title="Itálico"><i>I</i></button>
        <input type="color" id="color" title="Cor">
        <input type="number" id="size" title="Tamanho (px)" min="8" max="72" value="12">
        <button class="btn-tool" id="image" title="Imagem">🖼️</button>
      </div>` : ''}
      ${variableToolbar}
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

    const insertTokenIntoInput = (token: string): void => {
      const input = menu.querySelector<HTMLInputElement>('.floating-input')
      if (!input) return
      const start = input.selectionStart ?? input.value.length
      const end = input.selectionEnd ?? start
      input.value = `${input.value.slice(0, start)}${token}${input.value.slice(end)}`
      const next = start + token.length
      input.focus()
      input.setSelectionRange(next, next)
    }

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
      if (allowVariables) {
        menu.querySelectorAll<HTMLElement>('[data-variable]').forEach((button) => {
          button.addEventListener('click', () => {
            const token = documentVariableToken(button.dataset.variable as DocumentVariableName)
            miniEditor?.chain().focus().insertContent(token).run()
          })
        })
      }
    } else {
      container.innerHTML = `<input type="text" class="floating-input" value="${defaultValue.replace(/"/g, '&quot;')}" spellcheck="false">`
      if (allowVariables) {
        menu.querySelectorAll<HTMLElement>('[data-variable]').forEach((button) => {
          button.addEventListener('click', () => {
            const token = documentVariableToken(button.dataset.variable as DocumentVariableName)
            insertTokenIntoInput(token)
          })
        })
      }
    }

    const close = (): void => {
      try {
        miniEditor?.destroy()
        menu.remove()
      } finally {
        editorDom.classList.remove('is-editing')
      }
    }

    btnSave.onclick = () => {
      const val = richText ? miniEditor?.getHTML() ?? '' : (menu.querySelector('.floating-input') as HTMLInputElement).value
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
      else (menu.querySelector('.floating-input') as HTMLInputElement)?.focus()
    }, 10)
  }

  /** Aplica configurações iniciais (zoom, fonte, tema, visibilidade). */
  private applySettings(): void {
    applyFontProfile(this.els.editorHost, resolveFontProfile(this.settings.activeFontProfileId, this.settings.fontProfiles))
    this.setZoom(this.zoom)
    this.els.toolbar.removeAttribute('hidden')
    this.els.outline.parentElement?.toggleAttribute('hidden', !this.settings.showOutline)
    this.els.notes.parentElement?.toggleAttribute('hidden', !this.settings.showNotes)
    this.els.relations.parentElement?.toggleAttribute('hidden', !this.settings.showRelations)
    this.els.styles.parentElement?.setAttribute('hidden', '')
    this.els.statusBar.toggleAttribute('hidden', !this.settings.showWordCount)
    this.distractionFreeController.setEnabled(this.settings.distractionFree, false)
  }

  /** Trata atualizações de conteúdo: marca como sujo e atualiza painéis. */
  private handleUpdate(): void {
    this.setDirty(true)
    this.refresh()
    this.autoSaveController.scheduleDebounced()
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
    this.notePanel.update(this.editor.getJSON() as TipTapJSON, this.notes)
    void this.workspaceRelationsPanel.update(this.currentPath)
  }

  /** Define o estado de alterações não salvas e notifica o main. */
  private setDirty(dirty: boolean): void {
    this.dirtyState.setDirty(dirty)
  }

  /** Atualiza as configurações em tempo real e reaplica efeitos locais. */
  updateSettings(partial: Partial<ProsaSettings>): void {
    this.settings = { ...this.settings, ...partial }

    if (
      partial.distractionFree !== undefined &&
      partial.distractionFree !== this.distractionFreeController.isEnabled()
    ) {
      this.distractionFreeController.setEnabled(partial.distractionFree, false)
    }

    if (partial.showOutline !== undefined && !this.distractionFreeController.isEnabled()) {
      this.els.outline.parentElement?.toggleAttribute('hidden', !partial.showOutline)
    }

    if (partial.showNotes !== undefined) {
      this.els.notes.parentElement?.toggleAttribute('hidden', !partial.showNotes)
    }

    if (partial.showRelations !== undefined) {
      this.els.relations.parentElement?.toggleAttribute('hidden', !partial.showRelations)
    }

    if (partial.showWordCount !== undefined && !this.distractionFreeController.isEnabled()) {
      this.els.statusBar.toggleAttribute('hidden', !partial.showWordCount)
    }

    if (partial.focusWorkMinutes !== undefined || partial.focusBreakMinutes !== undefined) {
      this.focusTimer.setDurations(this.settings.focusWorkMinutes, this.settings.focusBreakMinutes)
    }

    if (partial.wordGoal !== undefined) {
      this.statusBar.setGoal(partial.wordGoal)
    }

    if (partial.autoSavePolicy !== undefined || partial.autoSaveDebounceSeconds !== undefined) {
      this.autoSaveController.scheduleDebounced()
    }
  }

  /** Cria um documento em branco. */
  async newDocument(): Promise<void> {
    const choice = await this.documentTemplateDialog.choose()
    if (!choice) return

    if (choice.kind === 'blank') {
      this.createBlankDocument()
      return
    }

    const template = choice.template
    if (!template) return
    this.setAcademicMode(false)
    this.persistenceController.newDocument({
      html: template.content,
      documentName: template.documentName,
      currentFormat: template.preferredFormat
    })
  }

  /** Carrega um documento aberto no editor. */
  load(doc: OpenedDocument): void {
    this.persistenceController.load(doc)
    this.setAcademicMode(doc.frontmatter?.mode === 'abnt')
  }

  /**
   * Salva o documento. Em "Salvar como", no primeiro salvamento, ou quando a
   * origem é somente leitura (.doc/.pdf), exibe o seletor de formato para o
   * usuário escolher; um "Salvar" comum reutiliza o formato atual sem
   * perguntar.
   */
  async save(forceDialog: boolean): Promise<void> {
    await this.persistenceController.save(forceDialog)
  }

  /** Exporta o documento atual para PDF. */
  async exportPdf(): Promise<void> {
    const preset = await this.pdfPresetDialog.choose(this.settings.pdfPreset)
    if (!preset) return
    this.settings.pdfPreset = preset
    await window.prosa.setSettings({ pdfPreset: preset })
    await this.persistenceController.exportPdf(preset)
  }

  /** Exporta o documento atual para HTML limpo. */
  async exportHtml(): Promise<void> {
    const options = await this.htmlExportDialog.choose()
    if (!options) return
    const defaultName = this.documentName.replace(/\.[^.]+$/, '')
    const result = await window.prosa.exportHtml(defaultName, this.editor.getJSON() as TipTapJSON, {
      ...options,
      title: defaultName
    }, this.notes)
    if (!result.ok && result.error) {
      window.alert(result.error)
    }
  }

  /** Exporta o documento atual para EPUB. */
  async exportEpub(): Promise<void> {
    await this.persistenceController.exportEpub()
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

  /** Abre a biblioteca do workspace. */
  async showWorkspaceLibrary(): Promise<void> {
    await this.workspaceLibrary.show()
  }

  /** Cria um documento acadêmico com estrutura ABNT inicial. */
  async createAbntDocument(): Promise<void> {
    const config = await this.abntDialog.choose({
      title: this.frontmatter.title ?? 'Trabalho acadêmico',
      author: this.frontmatter.author ?? 'Seu nome',
      institution: this.frontmatter.institution ?? 'Sua instituição',
      course: this.frontmatter.course ?? 'Seu curso',
      city: this.frontmatter.city ?? 'Sua cidade'
    })
    if (!config) return

    this.createBlankDocument()
    this.setAcademicMode(true)
    this.documentName = 'Trabalho-ABNT.prosa'
    this.frontmatter = {
      mode: 'abnt',
      title: config.title,
      subtitle: config.subtitle,
      author: config.author,
      institution: config.institution,
      course: config.course,
      advisor: config.advisor,
      city: config.city,
      year: config.year,
      tags: 'ABNT, acadêmico',
      collections: 'Trabalhos'
    }
    this.setPersistenceState({
      currentPath: null,
      currentFormat: 'prosa',
      documentName: this.documentName,
      headerHTML: '',
      footerHTML: '',
      frontmatter: this.frontmatter,
      notes: {}
    })
    this.statusBar.setDocumentName(this.documentName)
    this.editor.commands.setContent(this.buildAbntContent(config), false)
    this.setDirty(true)
    this.refresh()
    this.editor.commands.focus()
  }

  /** Cria um documento em branco sem abrir o seletor de modelos. */
  private createBlankDocument(): void {
    this.setAcademicMode(false)
    this.persistenceController.newDocument()
  }

  private setAcademicMode(enabled: boolean): void {
    this.els.root.classList.toggle('academic-mode', enabled)
    this.els.editorHost.classList.toggle('academic-mode', enabled)
  }

  private buildAbntContent(config: AbntTemplateData): string {
    const keywords = config.keywords
      .split(/[,;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .join('; ')

    const cover = `
      <p style="text-align:center; margin-top: 120px;"><strong>${escapeHtml(config.institution)}</strong></p>
      <p style="text-align:center; margin-top: 120px;"><strong>${escapeHtml(config.author)}</strong></p>
      <p style="text-align:center; margin-top: 140px;"><strong>${escapeHtml(config.title)}</strong></p>
      ${config.subtitle ? `<p style="text-align:center;"><em>${escapeHtml(config.subtitle)}</em></p>` : ''}
      <p style="text-align:center; margin-top: 140px;">${escapeHtml(config.city)}<br />${escapeHtml(config.year)}</p>
      <div data-page-break></div>
    `

    const roster = `
      <p style="text-align:right; margin-top: 80px; max-width: 55%; margin-left:auto;">
        <strong>${escapeHtml(config.author)}</strong><br />
        ${escapeHtml(config.title)}${config.subtitle ? `: ${escapeHtml(config.subtitle)}` : ''}<br />
        ${escapeHtml(config.course)}<br />
        ${escapeHtml(config.institution)}<br />
        Orientador: ${escapeHtml(config.advisor)}
      </p>
      <p style="margin-top: 140px; text-align:justify;">
        Texto de apresentação do trabalho.
      </p>
      <div data-page-break></div>
    `

    const abstract = `
      <h2>Resumo</h2>
      <p style="text-align:justify;">${escapeHtml(config.summary)}</p>
      <p><strong>Palavras-chave:</strong> ${escapeHtml(keywords)}</p>
      <div data-page-break></div>
    `

    const toc = `
      <h2>Sumário</h2>
      <p>1. Introdução .......................................................... 1</p>
      <p>2. Desenvolvimento .................................................... 2</p>
      <p>3. Conclusão .......................................................... 3</p>
      <div data-page-break></div>
    `

    const body = `
      <h1>Introdução</h1>
      <p></p>
      <h1>Desenvolvimento</h1>
      <p></p>
      <h1>Conclusão</h1>
      <p></p>
      <h1>Referências</h1>
      <p></p>
    `

    return [cover, roster, abstract, toc, body].join('')
  }

  /** Insere uma bibliografia formatada no documento atual. */
  async insertBibliography(style?: BibliographyStyle, keys: string[] = []): Promise<void> {
    const library = await window.prosa.getWorkspaceLibrary()
    const bibliographyStyle = style ?? library.bibliography.style
    const sourceKeys =
      keys.length > 0 ? keys : extractCitations(this.editor.getJSON() as TipTapJSON)
    const map = new Map(library.bibliography.entries.map((entry) => [entry.key, entry]))
    const ordered = [...new Set(sourceKeys)].filter((key) => map.has(key))
    const items =
      ordered.length > 0
        ? ordered
            .map((key, index) => `<li>${escapeHtml(formatBibliographyEntry(map.get(key)!, bibliographyStyle, index + 1))}</li>`)
            .join('')
        : '<li>Sem citações importadas.</li>'

    this.editor.chain().focus().insertContent(`<h2>Referências</h2><ol>${items}</ol>`).run()
    this.setDirty(true)
  }

  /** Alterna o workspace do projeto. */
  async switchWorkspace(): Promise<void> {
    const path = await window.prosa.selectDirectory()
    if (path) {
        window.prosa.setSettings({ workspacePath: path })
        window.location.reload()
    }
  }

  /** Escolhe a pasta observada para sincronização com serviços externos (Dropbox, Drive, etc). */
  async chooseSyncFolder(): Promise<void> {
    const path = await window.prosa.selectDirectory()
    if (path) await window.prosa.setSettings({ syncPath: path })
  }

  /** Desativa a sincronização com pastas externas. */
  async disableSync(): Promise<void> {
    await window.prosa.setSettings({ syncPath: '' })
  }

  /** Trata uma notificação de que um arquivo da pasta de sincronização mudou externamente. */
  handleSyncFileChanged(path: string): void {
    const currentPath = this.currentPath
    if (!currentPath || path !== currentPath) return
    this.syncNotification.show(this.documentName, () => {
      void window.prosa.openDocument(currentPath).then((res) => {
        if (res.ok && res.document) this.load(res.document)
      })
    })
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
    if (this.distractionFreeController.isEnabled()) {
      this.settings.showOutline = !this.settings.showOutline
      void window.prosa.setSettings({ showOutline: this.settings.showOutline })
      return
    }

    const panel = this.els.outline.parentElement
    panel?.toggleAttribute('hidden')
    const isHidden = panel?.hasAttribute('hidden') ?? true
    this.settings.showOutline = !isHidden
    void window.prosa.setSettings({ showOutline: this.settings.showOutline })
  }

  /** Alterna a visibilidade do painel de estilos. */
  toggleStyles(): void {
    const panel = this.els.styles.parentElement
    panel?.toggleAttribute('hidden')
  }

  /** Alterna a visibilidade do painel de notas. */
  toggleNotes(): void {
    const panel = this.els.notes.parentElement
    panel?.toggleAttribute('hidden')
    const isHidden = panel?.hasAttribute('hidden') ?? true
    this.settings.showNotes = !isHidden
    void window.prosa.setSettings({ showNotes: this.settings.showNotes })
  }

  /** Alterna a visibilidade do painel de relações do workspace. */
  toggleRelations(): void {
    const panel = this.els.relations.parentElement
    panel?.toggleAttribute('hidden')
    const isHidden = panel?.hasAttribute('hidden') ?? true
    this.settings.showRelations = !isHidden
    void window.prosa.setSettings({ showRelations: this.settings.showRelations })
  }

  /** Alterna a visibilidade da barra de contagem de palavras. */
  toggleWordCount(): void {
    if (this.distractionFreeController.isEnabled()) {
      this.settings.showWordCount = !this.settings.showWordCount
      void window.prosa.setSettings({ showWordCount: this.settings.showWordCount })
      return
    }

    this.els.statusBar.toggleAttribute('hidden')
    const isHidden = this.els.statusBar.hasAttribute('hidden')
    this.settings.showWordCount = !isHidden
    void window.prosa.setSettings({ showWordCount: this.settings.showWordCount })
  }

  /** Alterna o modo sem distrações (oculta chrome da interface de edição). */
  toggleDistractionFree(): void {
    this.distractionFreeController.setEnabled(!this.distractionFreeController.isEnabled())
  }

  /** Indica se há alterações não salvas. */
  get isDirty(): boolean {
    return this.dirtyState.isDirty()
  }

  /** Indica se o documento atual já possui caminho para autosave sem diálogo. */
  get hasCurrentPath(): boolean {
    return this.currentPath !== null
  }
}
