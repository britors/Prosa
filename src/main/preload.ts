// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  BackupVersion,
  FileResult,
  PluginInfo,
  ProsaApi,
  ProsaSettings,
  RecentFile,
  SavePayload
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
