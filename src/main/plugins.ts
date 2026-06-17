// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { app } from 'electron'
import { join } from 'node:path'
import { readdirSync, mkdirSync } from 'node:fs'

const pluginsPath = join(app.getPath('userData'), 'plugins')

export class PluginManager {
  private static instance: PluginManager
  private loadedPlugins: string[] = []

  private constructor() {}

  static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager()
    }
    return PluginManager.instance
  }

  async loadPlugins(): Promise<void> {
    try {
      mkdirSync(pluginsPath, { recursive: true })
      const files = readdirSync(pluginsPath).filter((file) => file.endsWith('.js'))
      this.loadedPlugins = files
      console.log('Plugins carregados:', this.loadedPlugins)
      // Futuramente: implementar isolamento e carregamento via utilityProcess
    } catch (err) {
      console.error('Erro ao carregar plugins:', err)
    }
  }

  getAvailablePlugins(): string[] {
    return this.loadedPlugins
  }
}
