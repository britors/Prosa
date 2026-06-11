// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  FileResult,
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
  getSystemFonts: () => ipcRenderer.invoke('fonts:list') as Promise<string[]>
}

contextBridge.exposeInMainWorld('prosa', api)
