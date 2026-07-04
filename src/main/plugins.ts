// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, dialog, utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { validatePluginManifest } from './plugin-manifest.js'
import { getSettings } from './settings.js'
import { importBibTeX } from './workspace.js'
import type { PluginInfo, PluginManifest } from '../shared/types.js'

const pluginsPath = join(app.getPath('userData'), 'plugins')
const disabledPluginsPath = join(app.getPath('userData'), 'plugins-disabled')
const pluginsDataPath = join(app.getPath('userData'), 'plugins-data')

interface RunningPlugin {
  id: string
  manifest: PluginManifest | null
  process: UtilityProcess | null
  status: 'loaded' | 'disabled' | 'error'
  error?: string
}

/** Mensagens que um plugin pode enviar ao processo principal. */
type PluginToMainMessage =
  | { type: 'log'; level?: 'info' | 'warn' | 'error'; message: string }
  | { type: 'storage:get'; requestId: string; key: string }
  | { type: 'storage:set'; requestId: string; key: string; value: unknown }
  | {
      type: 'dialog:openFile'
      requestId: string
      title?: string
      extensions?: string[]
    }
  | { type: 'workspace:importBibTeX'; requestId: string; content: string }

/** Mensagens que o processo principal pode enviar de volta a um plugin. */
type MainToPluginMessage =
  | { type: 'storage:result'; requestId: string; value: unknown }
  | { type: 'dialog:result'; requestId: string; value: string | null }
  | { type: 'workspace:result'; requestId: string; value: unknown }
  | { type: 'error'; requestId?: string; message: string }

const plugins = new Map<string, RunningPlugin>()

function isPluginToMainMessage(value: unknown): value is PluginToMainMessage {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return (
    type === 'log' ||
    type === 'storage:get' ||
    type === 'storage:set' ||
    type === 'dialog:openFile' ||
    type === 'workspace:importBibTeX'
  )
}

function storeFilePath(id: string): string {
  return join(pluginsDataPath, id, 'store.json')
}

async function readStore(id: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(storeFilePath(id), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

async function writeStore(id: string, store: Record<string, unknown>): Promise<void> {
  await mkdir(join(pluginsDataPath, id), { recursive: true })
  await writeFile(storeFilePath(id), JSON.stringify(store), 'utf-8')
}

/** Trata uma mensagem recebida de um plugin, aplicando as permissões declaradas. */
async function handlePluginMessage(entry: RunningPlugin, message: unknown): Promise<void> {
  if (!isPluginToMainMessage(message)) {
    console.warn(`[plugins] ${entry.id}: mensagem malformada ignorada.`)
    return
  }

  if (message.type === 'log') {
    const level = message.level ?? 'info'
    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
    logFn(`[plugin:${entry.id}] ${message.message}`)
    return
  }

  const manifest = entry.manifest
  const hasStorage = manifest?.permissions.includes('storage') ?? false
  const hasDialog = manifest?.permissions.includes('dialog') ?? false
  const hasWorkspace = manifest?.permissions.includes('workspace') ?? false
  if (!hasStorage) {
    if (message.type === 'storage:get' || message.type === 'storage:set') {
      console.warn(`[plugins] ${entry.id}: tentativa de usar "storage" sem permissão declarada.`)
      const reply: MainToPluginMessage = {
        type: 'error',
        requestId: message.requestId,
        message: "Permissão 'storage' não concedida."
      }
      entry.process?.postMessage(reply)
      return
    }
  }
  if (!hasDialog && message.type === 'dialog:openFile') {
    console.warn(`[plugins] ${entry.id}: tentativa de usar "dialog" sem permissão declarada.`)
    const reply: MainToPluginMessage = {
      type: 'error',
      requestId: message.requestId,
      message: "Permissão 'dialog' não concedida."
    }
    entry.process?.postMessage(reply)
    return
  }
  if (!hasWorkspace && message.type === 'workspace:importBibTeX') {
    console.warn(`[plugins] ${entry.id}: tentativa de usar "workspace" sem permissão declarada.`)
    const reply: MainToPluginMessage = {
      type: 'error',
      requestId: message.requestId,
      message: "Permissão 'workspace' não concedida."
    }
    entry.process?.postMessage(reply)
    return
  }

  try {
    if (message.type === 'storage:get') {
      const store = await readStore(entry.id)
      const reply: MainToPluginMessage = { type: 'storage:result', requestId: message.requestId, value: store[message.key] ?? null }
      entry.process?.postMessage(reply)
    } else if (message.type === 'storage:set') {
      const store = await readStore(entry.id)
      store[message.key] = message.value
      await writeStore(entry.id, store)
      const reply: MainToPluginMessage = { type: 'storage:result', requestId: message.requestId, value: message.value }
      entry.process?.postMessage(reply)
    } else if (message.type === 'dialog:openFile') {
      const result = await dialog.showOpenDialog({
        title: message.title ?? 'Abrir arquivo',
        properties: ['openFile'],
        filters: [
          {
            name: 'Bibliografia BibTeX',
            extensions: message.extensions?.length ? message.extensions : ['bib', 'txt']
          }
        ]
      })
      const reply: MainToPluginMessage = {
        type: 'dialog:result',
        requestId: message.requestId,
        value: result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
      }
      entry.process?.postMessage(reply)
    } else if (message.type === 'workspace:importBibTeX') {
      const settings = getSettings()
      if (!settings.workspacePath) {
        const reply: MainToPluginMessage = {
          type: 'error',
          requestId: message.requestId,
          message: 'Defina uma pasta de workspace para importar referências do Zotero.'
        }
        entry.process?.postMessage(reply)
        return
      }
      const value = await importBibTeX(settings.workspacePath, message.content)
      const reply: MainToPluginMessage = { type: 'workspace:result', requestId: message.requestId, value }
      entry.process?.postMessage(reply)
    }
  } catch (err) {
    const reply: MainToPluginMessage = {
      type: 'error',
      requestId: message.requestId,
      message: err instanceof Error ? err.message : 'Erro desconhecido ao acessar o armazenamento.'
    }
    entry.process?.postMessage(reply)
  }
}

function pluginPath(folderId: string, enabled: boolean): string {
  return join(enabled ? pluginsPath : disabledPluginsPath, folderId)
}

function readPluginEntry(folderId: string, enabled: boolean): RunningPlugin {
  const dir = pluginPath(folderId, enabled)
  try {
    const raw = readFileSync(join(dir, 'manifest.json'), 'utf-8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      const error = `manifest.json inválido (${err instanceof Error ? err.message : 'JSON malformado'})`
      console.error(`[plugins] ${folderId}: ${error}`)
      return { id: folderId, manifest: null, process: null, status: 'error', error }
    }

    const result = validatePluginManifest(parsed, dir, folderId)
    if (!result.ok) {
      const error = result.errors.join('; ')
      console.error(`[plugins] ${folderId}: manifesto inválido — ${error}`)
      return { id: folderId, manifest: null, process: null, status: 'error', error }
    }

    const manifest = result.manifest
    if (!enabled) {
      return { id: folderId, manifest, process: null, status: 'disabled' }
    }
    const entryPath = resolve(join(dir, manifest.entrypoint))
    const child = utilityProcess.fork(entryPath, [], { serviceName: manifest.id, stdio: 'pipe' })

    const entry: RunningPlugin = { id: folderId, manifest, process: child, status: 'loaded' }

    child.stdout?.on('data', (chunk: Buffer) => console.log(`[plugin:${manifest.id}]`, chunk.toString().trimEnd()))
    child.stderr?.on('data', (chunk: Buffer) => console.error(`[plugin:${manifest.id}]`, chunk.toString().trimEnd()))
    child.on('message', (message) => void handlePluginMessage(entry, message))
    child.on('exit', (code) => {
      const current = plugins.get(folderId)
      if (current) {
        current.status = 'error'
        current.error = `processo encerrado inesperadamente (código ${code})`
      }
      console.error(`[plugins] ${folderId}: processo encerrado (código ${code})`)
    })

    const permList = manifest.permissions.length > 0 ? manifest.permissions.join(', ') : 'nenhuma'
    console.log(`[plugins] ${manifest.id}: carregado (v${manifest.version}, permissões: ${permList})`)
    return entry
  } catch (err) {
    const error = err instanceof Error ? err.message : 'erro desconhecido ao carregar o plugin'
    console.error(`[plugins] ${folderId}: ${error}`)
    return { id: folderId, manifest: null, process: null, status: 'error', error }
  }
}

/** Escaneia userData/plugins e carrega cada plugin isoladamente. */
export async function loadPlugins(): Promise<void> {
  unloadPlugins()
  try {
    mkdirSync(pluginsPath, { recursive: true })
    mkdirSync(disabledPluginsPath, { recursive: true })
    mkdirSync(pluginsDataPath, { recursive: true })
  } catch (err) {
    console.error('[plugins] Erro ao preparar diretórios de plugins:', err)
    return
  }

  plugins.clear()

  let activeEntries: string[]
  try {
    activeEntries = readdirSync(pluginsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (err) {
    console.error('[plugins] Erro ao listar plugins:', err)
    return
  }

  for (const folderId of activeEntries) {
    plugins.set(folderId, readPluginEntry(folderId, true))
  }

  try {
    const disabledEntries = readdirSync(disabledPluginsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    for (const folderId of disabledEntries) {
      if (plugins.has(folderId)) continue
      plugins.set(folderId, readPluginEntry(folderId, false))
    }
  } catch (err) {
    console.error('[plugins] Erro ao listar plugins desativados:', err)
  }
}

/** Retorna o estado atual de todos os plugins conhecidos, para exibição na UI. */
export function getAvailablePlugins(): PluginInfo[] {
  return [...plugins.values()]
    .sort((a, b) => {
      const statusOrder = { loaded: 0, disabled: 1, error: 2 } as const
      return statusOrder[a.status] - statusOrder[b.status] || (a.manifest?.name ?? a.id).localeCompare(b.manifest?.name ?? b.id)
    })
    .map((entry) => ({
      id: entry.manifest?.id ?? entry.id,
      name: entry.manifest?.name ?? entry.id,
      version: entry.manifest?.version ?? '—',
      permissions: entry.manifest?.permissions ?? [],
      description: entry.manifest?.description,
      author: entry.manifest?.author,
      status: entry.status,
      error: entry.error
    }))
}

async function movePlugin(folderId: string, enable: boolean): Promise<void> {
  const from = pluginPath(folderId, !enable)
  const to = pluginPath(folderId, enable)
  if (!existsSync(from)) {
    throw new Error(`O plugin "${folderId}" não foi encontrado para ${enable ? 'ativação' : 'desativação'}.`)
  }
  await mkdir(join(to, '..'), { recursive: true })
  if (existsSync(to)) {
    throw new Error(`Já existe um plugin com id "${folderId}" na pasta de destino.`)
  }
  await rename(from, to)
}

/** Ativa um plugin previamente desativado. */
export async function enablePlugin(id: string): Promise<PluginInfo[]> {
  await movePlugin(id, true)
  await loadPlugins()
  return getAvailablePlugins()
}

/** Desativa um plugin carregado. */
export async function disablePlugin(id: string): Promise<PluginInfo[]> {
  const entry = plugins.get(id)
  if (entry?.process) {
    try {
      entry.process.kill()
    } catch {
      // Ignora falhas ao encerrar antes da mudança de pasta.
    }
  }
  await movePlugin(id, false)
  await loadPlugins()
  return getAvailablePlugins()
}

/** Remove um plugin da instalação local. */
export async function removePlugin(id: string): Promise<PluginInfo[]> {
  const entry = plugins.get(id)
  if (entry?.process) {
    try {
      entry.process.kill()
    } catch {
      // Ignora falhas ao encerrar antes de remover.
    }
  }
  const active = pluginPath(id, true)
  const disabled = pluginPath(id, false)
  if (existsSync(active)) {
    await rm(active, { recursive: true, force: true })
  } else if (existsSync(disabled)) {
    await rm(disabled, { recursive: true, force: true })
  } else {
    throw new Error(`O plugin "${id}" não foi encontrado para remoção.`)
  }
  await rm(join(pluginsDataPath, id), { recursive: true, force: true }).catch(() => {})
  await loadPlugins()
  return getAvailablePlugins()
}

/** Encerra todos os processos de plugin em execução (chamado ao fechar o app). */
export function unloadPlugins(): void {
  for (const entry of plugins.values()) {
    try {
      entry.process?.kill()
    } catch {
      // Ignora falhas ao encerrar — o app está fechando de qualquer forma.
    }
  }
  plugins.clear()
}
