// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  BibliographyStyle,
  BackupVersion,
  FileResult,
  HtmlExportOptions,
  FontProfile,
  NoteEntry,
  PluginInfo,
  ProsaApi,
  ProsaSettings,
  RecentFile,
  SavePayload,
  TipTapJSON,
  WorkspaceBibliographyState,
  WorkspaceLibraryData,
  WorkspaceRelations
} from '../shared/types.js'

/**
 * API segura exposta ao renderer através do contextBridge. Nenhum módulo
 * Node é acessível diretamente do renderer — tudo passa por IPC.
 */
const api: ProsaApi = {
  newDocument: () => ipcRenderer.invoke('file:new') as Promise<FileResult>,
  openDocument: (path?: string) =>
    ipcRenderer.invoke('file:open', path) as Promise<FileResult>,
  saveDocument: (payload: SavePayload) =>
    ipcRenderer.invoke('file:save', payload) as Promise<FileResult>,
  saveDocumentAs: (payload: SavePayload) =>
    ipcRenderer.invoke('file:saveAs', payload) as Promise<FileResult>,
  exportPdf: (defaultName: string) =>
    ipcRenderer.invoke('file:exportPdf', defaultName) as Promise<FileResult>,
  exportHtml: (defaultName: string, doc: TipTapJSON, options: HtmlExportOptions, notes?: Record<string, NoteEntry>) =>
    ipcRenderer.invoke('file:exportHtml', defaultName, doc, options, notes ?? {}) as Promise<FileResult>,
  exportEpub: (defaultName: string, payload: SavePayload) =>
    ipcRenderer.invoke('file:exportEpub', defaultName, payload) as Promise<FileResult>,
  print: () => ipcRenderer.invoke('file:print') as Promise<FileResult>,
  getRecentFiles: () =>
    ipcRenderer.invoke('file:recent') as Promise<RecentFile[]>,
  clearRecentFiles: () =>
    ipcRenderer.invoke('file:clearRecent') as Promise<RecentFile[]>,
  getSettings: () =>
    ipcRenderer.invoke('settings:get') as Promise<ProsaSettings>,
  setSettings: (settings: Partial<ProsaSettings>) =>
    ipcRenderer.invoke('settings:set', settings) as Promise<ProsaSettings>,
  onMenuAction: (handler) => {
    ipcRenderer.on('menu:action', (_event, action: string, payload?: unknown) => {
      handler(action, payload)
    })
  },
  notifyDirty: (dirty: boolean) => {
    ipcRenderer.send('document:dirty', dirty)
  },
  getAppInfo: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>,
  getSystemFonts: () => ipcRenderer.invoke('fonts:list') as Promise<string[]>,
  selectDirectory: () => ipcRenderer.invoke('file:selectDirectory') as Promise<string | null>,
  getPlugins: () => ipcRenderer.invoke('plugins:list') as Promise<PluginInfo[]>,
  enablePlugin: (id: string) => ipcRenderer.invoke('plugins:enable', id) as Promise<PluginInfo[]>,
  disablePlugin: (id: string) => ipcRenderer.invoke('plugins:disable', id) as Promise<PluginInfo[]>,
  removePlugin: (id: string) => ipcRenderer.invoke('plugins:remove', id) as Promise<PluginInfo[]>,
  getWorkspaceLibrary: () => ipcRenderer.invoke('workspace:getLibrary') as Promise<WorkspaceLibraryData>,
  updateWorkspaceCollections: (path: string, collections: string[]) =>
    ipcRenderer.invoke('workspace:updateCollections', path, collections) as Promise<WorkspaceLibraryData>,
  getWorkspaceRelations: (path: string) =>
    ipcRenderer.invoke('workspace:getRelations', path) as Promise<WorkspaceRelations>,
  importBibTeX: (content: string) =>
    ipcRenderer.invoke('workspace:importBibTeX', content) as Promise<WorkspaceBibliographyState>,
  setBibliographyStyle: (style: BibliographyStyle) =>
    ipcRenderer.invoke('workspace:setBibliographyStyle', style) as Promise<WorkspaceBibliographyState>,
  getTemplates: () => ipcRenderer.invoke('templates:list') as Promise<any[]>,
  getTemplate: (id: string) => ipcRenderer.invoke('templates:get', id) as Promise<string>,
  saveTemplate: (name: string, css: string) => ipcRenderer.invoke('templates:save', name, css),
  deleteTemplate: (id: string) => ipcRenderer.invoke('templates:delete', id),
  getPinnedFiles: () => ipcRenderer.invoke('file:pinned') as Promise<RecentFile[]>,
  pinFile: (file: RecentFile) => ipcRenderer.invoke('file:pin', file) as Promise<RecentFile[]>,
  unpinFile: (path: string) => ipcRenderer.invoke('file:unpin', path) as Promise<RecentFile[]>,
  searchFiles: (term: string) => ipcRenderer.invoke('file:search', term) as Promise<{ path: string; snippet: string }[]>,
  listVersions: (path: string) => ipcRenderer.invoke('versions:list', path) as Promise<BackupVersion[]>,
  getVersionText: (path: string, file: string) => ipcRenderer.invoke('versions:text', path, file) as Promise<string>,
  saveFontProfile: (profile: Omit<FontProfile, 'id'>) =>
    ipcRenderer.invoke('fontProfiles:save', profile) as Promise<FontProfile[]>,
  deleteFontProfile: (id: string) => ipcRenderer.invoke('fontProfiles:delete', id) as Promise<FontProfile[]>,
  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check') as Promise<void>,
  downloadUpdate: () => ipcRenderer.invoke('updater:download') as Promise<void>,
  installUpdate: () => { void ipcRenderer.invoke('updater:install') },
  onUpdateStatus: (handler) => {
    ipcRenderer.on('updater:status', (_event, status: any) => {
      handler(status)
    })
  }
}

contextBridge.exposeInMainWorld('prosa', api)
