// Prosa — Editor de Texto
// Copyright (C) 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
// SPDX-License-Identifier: GPL-3.0-or-later

import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'

/**
 * Inicializa o auto-updater (electron-updater). Em desenvolvimento a
 * verificação é ignorada para evitar erros sem um servidor de updates.
 */
export function initUpdater(window: BrowserWindow): void {
  if (!process.env.PROSA_ENABLE_UPDATER) {
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', () => {
    window.webContents.send('updater:status', { state: 'available' })
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

  void autoUpdater.checkForUpdatesAndNotify()
}
