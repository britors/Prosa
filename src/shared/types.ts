// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Tipos compartilhados entre os processos main e renderer do Prosa.
 */

/** Documento TipTap serializado em JSON (ProseMirror doc). */
export interface TipTapJSON {
  type: string
  content?: TipTapJSON[]
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  text?: string
}

/** Formatos de arquivo suportados pelo Prosa. */
export type FileFormat =
  | 'prosa'
  | 'docx'
  | 'odt'
  | 'rtf'
  | 'doc'
  | 'md'
  | 'txt'
  | 'pdf'

/** Metadados de um documento Prosa. */
export interface DocumentMetadata {
  title: string
  author: string
  createdAt: string
  modifiedAt: string
}

/** Estrutura do arquivo nativo `.prosa` (JSON). */
export interface ProsaFile {
  version: number
  content: TipTapJSON
  metadata: DocumentMetadata
  /** HTML do cabeçalho da página (opcional). */
  header?: string
  /** HTML do rodapé da página (opcional). */
  footer?: string
}

/** Item da lista de arquivos recentes. */
export interface RecentFile {
  path: string
  name: string
  modifiedAt: string
}

/** Configurações persistidas via electron-store. */
export interface ProsaSettings {
  theme: 'dark'
  fontSize: number
  fontFamily: string
  lineHeight: number
  spellcheck: boolean
  spellLanguages: string[]
  autoSave: boolean
  autoSaveInterval: number
  showWordCount: boolean
  showOutline: boolean
  recentFiles: RecentFile[]
  zoom: number
  workspacePath?: string
}

/** Conteúdo carregado de um arquivo aberto. */
export interface OpenedDocument {
  path: string | null
  name: string
  format: FileFormat
  /** Conteúdo já convertido para HTML para alimentar o editor. */
  html: string
  /** HTML do cabeçalho (apenas para o formato nativo .prosa). */
  header?: string
  /** HTML do rodapé (apenas para o formato nativo .prosa). */
  footer?: string
}

/** Resultado de uma operação de abrir/salvar arquivo. */
export interface FileResult {
  ok: boolean
  canceled?: boolean
  error?: string
  document?: OpenedDocument
  path?: string
}

/** Payload enviado pelo renderer ao salvar um documento. */
export interface SavePayload {
  /** Caminho atual do documento (null força "Salvar como"). */
  path: string | null
  /** Conteúdo do editor em HTML. */
  html: string
  /** Conteúdo do editor em JSON (TipTap). */
  json: TipTapJSON
  /** Texto puro (para exportação .txt e contagem). */
  text: string
  metadata: DocumentMetadata
  /** Formato alvo quando exportando. */
  format?: FileFormat
  /** HTML do cabeçalho da página. */
  header?: string
  /** HTML do rodapé da página. */
  footer?: string
}

/** Estilo de parágrafo rápido do painel de estilos. */
export type ParagraphStyle =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'blockquote'
  | 'codeBlock'
  | 'caption'

/** Canais IPC expostos ao renderer via preload. */
export interface ProsaApi {
  newDocument: () => Promise<FileResult>
  openDocument: (path?: string) => Promise<FileResult>
  saveDocument: (payload: SavePayload) => Promise<FileResult>
  saveDocumentAs: (payload: SavePayload) => Promise<FileResult>
  exportPdf: (defaultName: string) => Promise<FileResult>
  print: () => Promise<FileResult>
  getRecentFiles: () => Promise<RecentFile[]>
  getSettings: () => Promise<ProsaSettings>
  setSettings: (settings: Partial<ProsaSettings>) => Promise<ProsaSettings>
  onMenuAction: (handler: (action: string, payload?: unknown) => void) => void
  notifyDirty: (dirty: boolean) => void
  getAppInfo: () => Promise<AppInfo>
  getSystemFonts: () => Promise<string[]>
  selectDirectory: () => Promise<string | null>
  getPlugins: () => Promise<any[]>
  getTemplates: () => Promise<any[]>
  // Updater
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => void
  onUpdateStatus: (handler: (status: UpdateStatus) => void) => void
}

/** Status do auto-updater enviado ao renderer. */
export interface UpdateStatus {
  state: 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
  releaseNotes?: string | null
}

/** Informações exibidas na tela "Sobre". */
export interface AppInfo {
  name: string
  version: string
  license: string
  company: string
  website: string
  github: string
  support: string
  copyright: string
}
