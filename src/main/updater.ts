// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { autoUpdater } from 'electron-updater'
import { ipcMain, app, type BrowserWindow } from 'electron'

/**
 * Inicializa o auto-updater (electron-updater).
 */
export function initUpdater(window: BrowserWindow): void {
  // Configurações básicas
  autoUpdater.autoDownload = false // Vamos baixar manualmente via botão
  autoUpdater.autoInstallOnAppQuit = true

  // Eventos para o renderer
  autoUpdater.on('checking-for-update', () => {
    window.webContents.send('updater:status', { state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    window.webContents.send('updater:status', { 
      state: 'available', 
      version: info.version,
      releaseNotes: info.releaseNotes 
    })
  })

  autoUpdater.on('update-not-available', () => {
    window.webContents.send('updater:status', { state: 'up-to-date' })
  })

  autoUpdater.on('download-progress', (progressObj) => {
    window.webContents.send('updater:status', { 
      state: 'downloading', 
      percent: progressObj.percent 
    })
  })

  autoUpdater.on('update-downloaded', () => {
    window.webContents.send('updater:status', { state: 'downloaded' })
  })

  autoUpdater.on('error', (error) => {
    window.webContents.send('updater:status', {
      state: 'error',
      message: error.message
    })
  })

  // Handlers IPC para controle manual
  ipcMain.handle('updater:check', async () => {
    return await autoUpdater.checkForUpdates()
  })

  ipcMain.handle('updater:download', async () => {
    return await autoUpdater.downloadUpdate()
  })

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall()
  })

  // Verificação inicial automática
  if (process.env.PROSA_ENABLE_UPDATER || app.isPackaged) {
    void autoUpdater.checkForUpdates()
  }
}

