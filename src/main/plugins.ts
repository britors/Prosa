// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, utilityProcess } from 'electron'
import type { UtilityProcess } from 'electron'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { validatePluginManifest } from './plugin-manifest.js'
import type { PluginInfo, PluginManifest } from '../shared/types.js'

const pluginsPath = join(app.getPath('userData'), 'plugins')
const pluginsDataPath = join(app.getPath('userData'), 'plugins-data')

interface RunningPlugin {
  id: string
  manifest: PluginManifest | null
  process: UtilityProcess | null
  status: 'loaded' | 'error'
  error?: string
}

/** Mensagens que um plugin pode enviar ao processo principal. */
type PluginToMainMessage =
  | { type: 'log'; level?: 'info' | 'warn' | 'error'; message: string }
  | { type: 'storage:get'; requestId: string; key: string }
  | { type: 'storage:set'; requestId: string; key: string; value: unknown }

/** Mensagens que o processo principal pode enviar de volta a um plugin. */
type MainToPluginMessage =
  | { type: 'storage:result'; requestId: string; value: unknown }
  | { type: 'error'; requestId?: string; message: string }

const plugins = new Map<string, RunningPlugin>()

function isPluginToMainMessage(value: unknown): value is PluginToMainMessage {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return type === 'log' || type === 'storage:get' || type === 'storage:set'
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
  if (!hasStorage) {
    console.warn(`[plugins] ${entry.id}: tentativa de usar "storage" sem permissão declarada.`)
    const reply: MainToPluginMessage = {
      type: 'error',
      requestId: message.requestId,
      message: "Permissão 'storage' não concedida."
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

/** Carrega um plugin isolado a partir de sua pasta. Nunca lança — falhas viram status 'error'. */
function loadPlugin(folderId: string): void {
  const pluginDir = join(pluginsPath, folderId)
  try {
    const raw = readFileSync(join(pluginDir, 'manifest.json'), 'utf-8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      const error = `manifest.json inválido (${err instanceof Error ? err.message : 'JSON malformado'})`
      plugins.set(folderId, { id: folderId, manifest: null, process: null, status: 'error', error })
      console.error(`[plugins] ${folderId}: ${error}`)
      return
    }

    const result = validatePluginManifest(parsed, pluginDir, folderId)
    if (!result.ok) {
      const error = result.errors.join('; ')
      plugins.set(folderId, { id: folderId, manifest: null, process: null, status: 'error', error })
      console.error(`[plugins] ${folderId}: manifesto inválido — ${error}`)
      return
    }

    const manifest = result.manifest
    const entryPath = resolve(join(pluginDir, manifest.entrypoint))
    const child = utilityProcess.fork(entryPath, [], { serviceName: manifest.id, stdio: 'pipe' })

    const entry: RunningPlugin = { id: folderId, manifest, process: child, status: 'loaded' }
    plugins.set(folderId, entry)

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
  } catch (err) {
    const error = err instanceof Error ? err.message : 'erro desconhecido ao carregar o plugin'
    plugins.set(folderId, { id: folderId, manifest: null, process: null, status: 'error', error })
    console.error(`[plugins] ${folderId}: ${error}`)
  }
}

/** Escaneia userData/plugins e carrega cada plugin isoladamente. */
export async function loadPlugins(): Promise<void> {
  try {
    mkdirSync(pluginsPath, { recursive: true })
    mkdirSync(pluginsDataPath, { recursive: true })
  } catch (err) {
    console.error('[plugins] Erro ao preparar diretórios de plugins:', err)
    return
  }

  let entries: string[]
  try {
    entries = readdirSync(pluginsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (err) {
    console.error('[plugins] Erro ao listar plugins:', err)
    return
  }

  for (const folderId of entries) {
    loadPlugin(folderId)
  }
}

/** Retorna o estado atual de todos os plugins conhecidos, para exibição na UI. */
export function getAvailablePlugins(): PluginInfo[] {
  return [...plugins.values()].map((entry) => ({
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
