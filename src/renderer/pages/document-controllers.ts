// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { documentText } from '../../shared/document-utils.js'
import type {
  NoteEntry,
  FileFormat,
  OpenedDocument,
  ProsaSettings,
  SavePayload,
  TipTapJSON
} from '../../shared/types.js'

interface AutoSaveState {
  currentPath: string | null
  dirty: boolean
  autoSavePolicy: ProsaSettings['autoSavePolicy']
  autoSaveDebounceSeconds: number
}

interface DistractionFreeElements {
  root: HTMLElement
  toolbar: HTMLElement
  outlinePanel: HTMLElement | null
  stylesPanel: HTMLElement | null
  statusBar: HTMLElement
}

interface PreviousUiState {
  toolbarHidden: boolean
  outlineHidden: boolean
  stylesHidden: boolean
  statusBarHidden: boolean
}

export class DirtyStateController {
  private dirty = false

  constructor(
    private readonly onDirtyUiChange: (dirty: boolean) => void,
    private readonly notifyDirty: (dirty: boolean) => void
  ) {}

  setDirty(dirty: boolean): void {
    if (this.dirty === dirty) return
    this.dirty = dirty
    this.onDirtyUiChange(dirty)
    this.notifyDirty(dirty)
  }

  isDirty(): boolean {
    return this.dirty
  }
}

export class AutoSaveController {
  private autoSaveTimer: number | null = null

  constructor(
    private readonly getState: () => AutoSaveState,
    private readonly save: () => Promise<void>
  ) {}

  scheduleDebounced(): void {
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer)
      this.autoSaveTimer = null
    }

    const state = this.getState()
    if (state.autoSavePolicy !== 'debounce' || !state.currentPath) return

    const delaySeconds = Math.max(1, state.autoSaveDebounceSeconds)
    this.autoSaveTimer = window.setTimeout(() => {
      this.autoSaveTimer = null
      const current = this.getState()
      if (!current.currentPath || !current.dirty) return
      void this.save()
    }, delaySeconds * 1000)
  }

  onWindowBlur(): void {
    const state = this.getState()
    if (state.autoSavePolicy !== 'onBlur') return
    if (!state.currentPath || !state.dirty) return
    void this.save()
  }

  dispose(): void {
    if (this.autoSaveTimer !== null) {
      window.clearTimeout(this.autoSaveTimer)
      this.autoSaveTimer = null
    }
  }
}

export class DistractionFreeController {
  private enabled: boolean
  private previousUiState: PreviousUiState = {
    toolbarHidden: false,
    outlineHidden: true,
    stylesHidden: true,
    statusBarHidden: false
  }

  constructor(
    private readonly els: DistractionFreeElements,
    initialEnabled: boolean,
    private readonly updateSettings: (partial: Partial<ProsaSettings>) => void
  ) {
    this.enabled = initialEnabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean, persist = true): void {
    if (enabled === this.enabled && persist) return

    if (enabled) {
      this.previousUiState = {
        toolbarHidden: this.els.toolbar.hasAttribute('hidden'),
        outlineHidden: this.els.outlinePanel?.hasAttribute('hidden') ?? true,
        stylesHidden: this.els.stylesPanel?.hasAttribute('hidden') ?? true,
        statusBarHidden: this.els.statusBar.hasAttribute('hidden')
      }

      this.els.toolbar.setAttribute('hidden', '')
      this.els.outlinePanel?.setAttribute('hidden', '')
      this.els.stylesPanel?.setAttribute('hidden', '')
      this.els.statusBar.setAttribute('hidden', '')
    } else {
      this.els.toolbar.toggleAttribute('hidden', this.previousUiState.toolbarHidden)
      this.els.outlinePanel?.toggleAttribute('hidden', this.previousUiState.outlineHidden)
      this.els.stylesPanel?.toggleAttribute('hidden', this.previousUiState.stylesHidden)
      this.els.statusBar.toggleAttribute('hidden', this.previousUiState.statusBarHidden)
    }

    this.enabled = enabled
    this.els.root.classList.toggle('distraction-free', enabled)

    if (persist) {
      this.updateSettings({ distractionFree: enabled })
    }
  }
}

interface PersistenceState {
  currentPath: string | null
  currentFormat: FileFormat | null
  documentName: string
  headerHTML: string
  footerHTML: string
  frontmatter: Record<string, string>
  notes: Record<string, NoteEntry>
}

interface PersistencePayloadData {
  html: string
  json: TipTapJSON
}

interface SaveResult {
  ok: boolean
  path?: string
  error?: string
}

interface PersistenceDeps {
  getState: () => PersistenceState
  setState: (state: PersistenceState) => void
  chooseFormat: (preset: FileFormat) => Promise<FileFormat | null>
  saveDocument: (payload: SavePayload) => Promise<SaveResult>
  saveDocumentAs: (payload: SavePayload) => Promise<SaveResult>
  exportPdf: (name: string) => Promise<{ error?: string }>
  exportEpub: (name: string, payload: SavePayload) => Promise<{ error?: string }>
  setDirty: (dirty: boolean) => void
  setDocumentName: (name: string) => void
  setEditorContent: (html: string) => void
  clearEditorContent: () => void
  focusEditor: () => void
  updatePaginationBands: () => void
  refresh: () => void
  getPayloadData: () => PersistencePayloadData
  alertError: (message: string) => void
}

export class DocumentPersistenceController {
  constructor(
    private readonly deps: PersistenceDeps,
    private readonly writableFormats: ReadonlySet<FileFormat>
  ) {}

  newDocument(): void {
    this.deps.clearEditorContent()
    const next: PersistenceState = {
      currentPath: null,
      currentFormat: null,
      documentName: 'Sem título',
      headerHTML: '',
      footerHTML: '',
      frontmatter: {},
      notes: {}
    }
    this.deps.setState(next)
    this.deps.setDocumentName(next.documentName)
    this.deps.updatePaginationBands()
    this.deps.setDirty(false)
    this.deps.refresh()
    this.deps.focusEditor()
  }

  load(doc: OpenedDocument): void {
    this.deps.setEditorContent(doc.html)
    this.deps.setState({
      currentPath: doc.path,
      currentFormat: doc.format,
      documentName: doc.name,
      headerHTML: doc.header ?? '',
      footerHTML: doc.footer ?? '',
      frontmatter: doc.frontmatter ?? {},
      notes: doc.notes ?? {}
    })
    this.deps.setDocumentName(doc.name)
    this.deps.updatePaginationBands()
    this.deps.setDirty(false)
    this.deps.refresh()
  }

  async save(forceDialog: boolean): Promise<void> {
    const state = this.deps.getState()
    const sourceReadOnly =
      state.currentFormat !== null && !this.writableFormats.has(state.currentFormat)
    const asDialog = forceDialog || sourceReadOnly
    const needsFormat = asDialog || !state.currentPath

    let chosenFormat: FileFormat | undefined
    if (needsFormat) {
      const preset =
        state.currentFormat && this.writableFormats.has(state.currentFormat)
          ? state.currentFormat
          : 'prosa'
      const picked = await this.deps.chooseFormat(preset)
      if (!picked) return
      chosenFormat = picked
    }

    const payload = this.buildPayload(state)
    if (chosenFormat) payload.format = chosenFormat

    const result = asDialog
      ? await this.deps.saveDocumentAs(payload)
      : await this.deps.saveDocument(payload)

    if (result.ok && result.path) {
      const nextName = result.path.split(/[\\/]/).pop() ?? state.documentName
      this.deps.setState({
        ...state,
        currentPath: result.path,
        currentFormat: chosenFormat ?? state.currentFormat,
        documentName: nextName
      })
      this.deps.setDocumentName(nextName)
      this.deps.setDirty(false)
      return
    }

    if (result.error) {
      this.deps.alertError(`Erro ao salvar: ${result.error}`)
    }
  }

  async exportPdf(): Promise<void> {
    const state = this.deps.getState()
    const name = state.documentName.replace(/\.[^.]+$/, '')
    const result = await this.deps.exportPdf(name)
    if (result.error) {
      this.deps.alertError(`Erro ao exportar PDF: ${result.error}`)
    }
  }

  async exportEpub(): Promise<void> {
    const state = this.deps.getState()
    const name = state.documentName.replace(/\.[^.]+$/, '')
    const payload = this.buildPayload(state)
    const result = await this.deps.exportEpub(name, payload)
    if (result.error) {
      this.deps.alertError(`Erro ao exportar EPUB: ${result.error}`)
    }
  }

  private buildPayload(state: PersistenceState): SavePayload {
    const payloadData = this.deps.getPayloadData()
    const now = new Date().toISOString()
    return {
      path: state.currentPath,
      html: payloadData.html,
      json: payloadData.json,
      text: documentText(payloadData.json),
      header: state.headerHTML,
      footer: state.footerHTML,
      frontmatter: state.frontmatter,
      notes: state.notes,
        metadata: {
          title: state.documentName.replace(/\.[^.]+$/, ''),
          author: state.frontmatter.author ?? '',
          createdAt: now,
          modifiedAt: now
        }
    }
  }
}
