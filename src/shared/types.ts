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
  | 'epub'
  | 'doc'
  | 'md'
  | 'txt'
  | 'pdf'

/** Modo de exportação HTML. */
export type HtmlExportMode = 'full' | 'content'

/** Opções da exportação HTML limpa. */
export interface HtmlExportOptions {
  mode: HtmlExportMode
  includeStyles: boolean
  title?: string
}

/** Metadados de um documento Prosa. */
export interface DocumentMetadata {
  title: string
  author: string
  createdAt: string
  modifiedAt: string
}

/** Tipo de nota suportado pelo documento. */
export type NoteKind = 'footnote' | 'endnote'

/** Estrutura persistida de uma nota. */
export interface NoteEntry {
  id: string
  kind: NoteKind
  text: string
}

/** Estilos bibliográficos suportados pelo workspace. */
export type BibliographyStyle = 'ABNT' | 'APA' | 'IEEE'

/** Resumo de um documento indexado no workspace. */
export interface WorkspaceDocumentSummary {
  path: string
  name: string
  title: string
  format: FileFormat
  modifiedAt: string
  tags: string[]
  collections: string[]
  workspaceCollections?: string[]
  citations: string[]
  links: string[]
  excerpt: string
}

/** Entrada bibliográfica importada de BibTeX. */
export interface BibliographyEntry {
  key: string
  type: string
  title: string
  author: string
  editor?: string
  year: string
  journal?: string
  booktitle?: string
  publisher?: string
  institution?: string
  school?: string
  volume?: string
  number?: string
  pages?: string
  doi?: string
  url?: string
  raw: string
}

/** Estado persistido da bibliografia do workspace. */
export interface WorkspaceBibliographyState {
  style: BibliographyStyle
  importedAt: string | null
  entries: BibliographyEntry[]
}

/** Relações de um documento dentro do workspace. */
export interface WorkspaceRelations {
  backlinks: WorkspaceDocumentSummary[]
  related: WorkspaceDocumentSummary[]
  brokenLinks: string[]
}

/** Dados da biblioteca do workspace. */
export interface WorkspaceLibraryData {
  root: string | null
  documents: WorkspaceDocumentSummary[]
  recentFiles: RecentFile[]
  pinnedFiles: RecentFile[]
  bibliography: WorkspaceBibliographyState
  error?: string | null
}

/** Estrutura do arquivo nativo `.prosa` (JSON). */
export interface ProsaFile {
  version: number
  content: TipTapJSON
  metadata: DocumentMetadata
  notes?: Record<string, NoteEntry>
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

/** Versão de backup disponível para comparação. */
export interface BackupVersion {
  file: string
  modifiedAt: string
}

/** Políticas de autosave suportadas. */
export type AutoSavePolicy = 'off' | 'onBlur' | 'debounce' | 'interval'

/** Tamanhos de página suportados na exportação PDF. */
export type PdfPageSize = 'A4' | 'Letter' | 'Legal'

/** Presets profissionais de exportação PDF. */
export type PdfPreset = 'academic' | 'report' | 'contract' | 'book'

/** Provedores de IA suportados pela configuração inicial. */
export type AiProvider = 'openai' | 'gemini'

/** Estado da chave de API de um provedor de IA, sem expor o segredo. */
export interface AiApiKeyStatus {
  provider: AiProvider
  configured: boolean
  encryptionAvailable: boolean
}

/** Pedido interno para geração de texto por IA. */
export interface AiTextRequest {
  instruction: string
  input: string
  provider?: AiProvider
  model?: string
  maxOutputTokens?: number
}

/** Resultado normalizado de um provedor de IA. */
export interface AiTextResult {
  provider: AiProvider
  model: string
  text: string
}

/** Ações de escrita assistida aceitas pelo IPC. */
export type AiWritingAction =
  | 'custom'
  | 'review'
  | 'improveClarity'
  | 'summarize'
  | 'generateAbstract'
  | 'generateIntroduction'
  | 'generateConclusion'
  | 'extractKeywords'
  | 'suggestTitles'
  | 'mainPoints'
  | 'analyzeIssues'
  | 'reviewToneConsistency'
  | 'standardizeLanguage'
  | 'flagWeakPassages'
  | 'suggestArgumentExpansion'
  | 'checkVerbPersonConsistency'
  | 'suggestStructure'
  | 'compareOutline'
  | 'suggestSectionBreakdown'
  | 'detectLongSections'
  | 'suggestTransitions'
  | 'reorganizeIdeas'
  | 'verifyBibliography'
  | 'findMissingReferences'
  | 'findUnusedReferences'
  | 'suggestBibliographyStyleAdjustments'
  | 'summarizeUsedReferences'
  | 'suggestCitationNeededPlaces'
  | 'transformDraftToAcademicArticle'
  | 'transformToProfessionalReport'
  | 'createShortAndLongVersions'
  | 'generatePresentationOutline'
  | 'createEditorialChecklist'
  | 'expand'
  | 'translate'
  | 'changeTone'

/** Payload seguro para ações de escrita assistida. */
export interface AiWritingRequest {
  action: AiWritingAction
  text: string
  instruction?: string
  targetLanguage?: string
  tone?: string
}

/** Perfil de fonte nomeado, aplicável ao editor. */
export interface FontProfile {
  id: string
  name: string
  fontFamily: string
  fontSize: number
  lineHeight: number
}

/** Permissões que um plugin pode declarar (conjunto v1, deliberadamente mínimo). */
export type PluginPermission = 'storage'
  | 'dialog'
  | 'workspace'

/** Manifesto declarado por um plugin em manifest.json. */
export interface PluginManifest {
  id: string
  name: string
  version: string
  entrypoint: string
  permissions: PluginPermission[]
  description?: string
  author?: string
}

/** Estado de um plugin exposto ao renderer (sem o entrypoint, irrelevante para a UI). */
export interface PluginInfo {
  id: string
  name: string
  version: string
  permissions: PluginPermission[]
  description?: string
  author?: string
  status: 'loaded' | 'disabled' | 'error'
  error?: string
}

/** Configurações persistidas via electron-store. */
export interface ProsaSettings {
  theme: 'dark'
  fontSize: number
  fontFamily: string
  lineHeight: number
  spellcheck: boolean
  spellLanguages: string[]
  autoSavePolicy: AutoSavePolicy
  autoSaveDebounceSeconds: number
  autoSaveIntervalMinutes: number
  backupOnSave: boolean
  backupKeepVersions: number
  pdfPageSize: PdfPageSize
  pdfLandscape: boolean
  pdfPrintBackground: boolean
  pdfPreset: PdfPreset
  focusWorkMinutes: number
  focusBreakMinutes: number
  wordGoal: number
  fontProfiles: FontProfile[]
  activeFontProfileId: string
  showWordCount: boolean
  showOutline: boolean
  showNotes: boolean
  showRelations: boolean
  distractionFree: boolean
  aiEnabled: boolean
  aiProvider: AiProvider
  aiModel: string
  aiApiKeyConfigured?: boolean
  recentFiles: RecentFile[]
  pinnedFiles: RecentFile[]
  zoom: number
  workspacePath?: string
  syncPath?: string
}

/** Conteúdo carregado de um arquivo aberto. */
export interface OpenedDocument {
  path: string | null
  name: string
  format: FileFormat
  /** Conteúdo já convertido para HTML para alimentar o editor. */
  html: string
  /** Notas persistidas no arquivo, quando houver. */
  notes?: Record<string, NoteEntry>
  /** HTML do cabeçalho (apenas para o formato nativo .prosa). */
  header?: string
  /** HTML do rodapé (apenas para o formato nativo .prosa). */
  footer?: string
  /** Frontmatter YAML (chave/valor), extraído de arquivos .md ou guardado em .prosa. */
  frontmatter?: Record<string, string>
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
  /** Notas persistidas no arquivo nativo .prosa. */
  notes?: Record<string, NoteEntry>
  /** Formato alvo quando exportando. */
  format?: FileFormat
  /** HTML do cabeçalho da página. */
  header?: string
  /** HTML do rodapé da página. */
  footer?: string
  /** Frontmatter YAML (chave/valor) a preservar/escrever no .md ou .prosa. */
  frontmatter?: Record<string, string>
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
  exportPdf: (defaultName: string, preset?: PdfPreset) => Promise<FileResult>
  exportHtml: (defaultName: string, doc: TipTapJSON, options: HtmlExportOptions, notes?: Record<string, NoteEntry>) => Promise<FileResult>
  exportEpub: (defaultName: string, payload: SavePayload) => Promise<FileResult>
  print: () => Promise<FileResult>
  getRecentFiles: () => Promise<RecentFile[]>
  clearRecentFiles: () => Promise<RecentFile[]>
  getSettings: () => Promise<ProsaSettings>
  setSettings: (settings: Partial<ProsaSettings>) => Promise<ProsaSettings>
  getAiApiKeyStatus: (provider?: AiProvider) => Promise<AiApiKeyStatus>
  setAiApiKey: (provider: AiProvider, apiKey: string) => Promise<AiApiKeyStatus>
  removeAiApiKey: (provider: AiProvider) => Promise<AiApiKeyStatus>
  runAiWritingAction: (request: AiWritingRequest) => Promise<AiTextResult>
  onMenuAction: (handler: (action: string, payload?: unknown) => void) => void
  notifyDirty: (dirty: boolean) => void
  getAppInfo: () => Promise<AppInfo>
  getSystemFonts: () => Promise<string[]>
  selectDirectory: () => Promise<string | null>
  getPlugins: () => Promise<PluginInfo[]>
  enablePlugin: (id: string) => Promise<PluginInfo[]>
  disablePlugin: (id: string) => Promise<PluginInfo[]>
  removePlugin: (id: string) => Promise<PluginInfo[]>
  getWorkspaceLibrary: () => Promise<WorkspaceLibraryData>
  getWorkspaceRelations: (path: string) => Promise<WorkspaceRelations>
  updateWorkspaceCollections: (path: string, collections: string[]) => Promise<WorkspaceLibraryData>
  importBibTeX: (content: string) => Promise<WorkspaceBibliographyState>
  setBibliographyStyle: (style: BibliographyStyle) => Promise<WorkspaceBibliographyState>
  getTemplates: () => Promise<any[]>
  getTemplate: (id: string) => Promise<string>
  saveTemplate: (name: string, css: string) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  getPinnedFiles: () => Promise<RecentFile[]>
  pinFile: (file: RecentFile) => Promise<RecentFile[]>
  unpinFile: (path: string) => Promise<RecentFile[]>
  searchFiles: (term: string) => Promise<{ path: string; snippet: string }[]>
  listVersions: (path: string) => Promise<BackupVersion[]>
  getVersionText: (path: string, file: string) => Promise<string>
  saveFontProfile: (profile: Omit<FontProfile, 'id'>) => Promise<FontProfile[]>
  deleteFontProfile: (id: string) => Promise<FontProfile[]>
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
