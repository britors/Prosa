// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Editor } from '@tiptap/core'
import { createEditor, insertImageFile } from '../editor/editor.js'
import { createToolbar } from '../editor/toolbar.js'
import { SidebarOutline } from '../components/sidebar-outline.js'
import { StylesPanel } from '../components/styles-panel.js'
import { FindReplacePanel } from '../components/find-replace.js'
import { WordCountBar } from '../components/word-count-bar.js'
import { applyDocumentTheme } from '../components/theme-selector.js'
import { FormatDialog } from '../components/format-dialog.js'
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
  readonly editor: Editor
  private readonly els: DocumentViewElements
  private readonly outline: SidebarOutline
  private readonly styles: StylesPanel
  private readonly findReplace: FindReplacePanel
  private readonly statusBar: WordCountBar
  private readonly formatDialog: FormatDialog
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

  constructor(els: DocumentViewElements, settings: ProsaSettings) {
    this.els = els
    this.settings = settings
    this.zoom = settings.zoom

    this.editor = createEditor(els.editorHost, {
      onUpdate: () => this.handleUpdate(),
      onSelectionUpdate: () => this.handleSelectionUpdate(),
      onMatchesUpdate: (current, total) =>
        this.findReplace.updateCounter(current, total),
      onHeaderClick: () => this.promptHeader(),
      onFooterClick: () => this.promptFooter()
    })

    this.findReplace = new FindReplacePanel(els.toolbar.parentElement ?? els.root, this.editor)
    
    // Agora createToolbar é assíncrono
    void createToolbar(els.toolbar, this.editor, {
      onFind: () => this.findReplace.show(false),
      onPrint: () => void window.prosa.print(),
      onInsertImage: () => this.openImagePicker()
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
    this.refresh()
  }

  /** Atualiza o conteúdo repetido das bandas de paginação. */
  private updatePaginationBands(): void {
    // Sincroniza o conteúdo com o plugin de paginação para repetição em todas as páginas.
    this.editor.commands.updateHeaderContent(this.headerHTML, '')
    this.editor.commands.updateFooterContent(this.footerHTML, 'Página {page}')
  }
/** Abre um prompt para editar o cabeçalho. */
private promptHeader(): void {
  const current = this.headerHTML.replace(/<[^>]*>/g, '')
  this.customPrompt('Editar cabeçalho:', current, (val) => {
    this.headerHTML = val
    this.updatePaginationBands()
    this.setDirty(true)
  })
}

/** Abre um prompt para editar o rodapé. */
private promptFooter(): void {
  const current = this.footerHTML.replace(/<[^>]*>/g, '')
  this.customPrompt('Editar rodapé:', current, (val) => {
    this.footerHTML = val
    this.updatePaginationBands()
    this.setDirty(true)
  })
}
  /** 
   * Implementação de um prompt customizado via DOM para contornar a restrição do Electron.
   */
  private customPrompt(title: string, defaultValue: string, callback: (val: string) => void): void {
    const overlay = document.createElement('div')
    overlay.className = 'prompt-overlay'
    
    overlay.innerHTML = `
      <div class="prompt-card">
        <div class="prompt-title">${title}</div>
        <input type="text" class="prompt-input" value="${defaultValue.replace(/"/g, '&quot;')}" spellcheck="false">
        <div class="prompt-actions">
          <button class="btn btn-cancel">Cancelar</button>
          <button class="btn btn-primary btn-save">OK</button>
        </div>
      </div>
    `

    const input = overlay.querySelector('input') as HTMLInputElement
    const btnSave = overlay.querySelector('.btn-save') as HTMLButtonElement
    const btnCancel = overlay.querySelector('.btn-cancel') as HTMLButtonElement

    const close = () => overlay.remove()

    btnSave.onclick = () => {
      callback(input.value)
      close()
    }

    btnCancel.onclick = close
    
    overlay.onclick = (e) => {
      if (e.target === overlay) close()
    }

    input.onkeydown = (e) => {
      if (e.key === 'Enter') btnSave.click()
      if (e.key === 'Escape') close()
    }

    document.body.appendChild(overlay)
    setTimeout(() => input.focus(), 10)
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
