// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { PluginManifest, PluginPermission } from '../shared/types.js'

/** Conjunto de permissões reconhecidas em v1 — cada uma precisa de enforcement real. */
export const PLUGIN_PERMISSIONS: readonly PluginPermission[] = ['storage']

const ID_PATTERN = /^[a-z0-9-]+$/
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/

export interface ManifestValidationOk {
  ok: true
  manifest: PluginManifest
}

export interface ManifestValidationError {
  ok: false
  errors: string[]
}

export type ManifestValidationResult = ManifestValidationOk | ManifestValidationError

function isPluginPermission(value: unknown): value is PluginPermission {
  return typeof value === 'string' && (PLUGIN_PERMISSIONS as readonly string[]).includes(value)
}

/** Valida um manifesto bruto (já parseado de JSON) contra o schema esperado. */
export function validatePluginManifest(
  raw: unknown,
  pluginDir: string,
  folderId: string
): ManifestValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['manifest.json precisa conter um objeto JSON.'] }
  }

  const data = raw as Record<string, unknown>
  const errors: string[] = []

  const id = typeof data.id === 'string' ? data.id.trim() : ''
  if (!id || !ID_PATTERN.test(id)) {
    errors.push(`"id" inválido — deve conter apenas letras minúsculas, números e hífens (recebido: ${JSON.stringify(data.id)}).`)
  } else if (id !== folderId) {
    errors.push(`"id" ("${id}") precisa ser igual ao nome da pasta do plugin ("${folderId}").`)
  }

  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (!name) {
    errors.push('"name" é obrigatório e não pode ser vazio.')
  }

  const version = typeof data.version === 'string' ? data.version.trim() : ''
  if (!version || !SEMVER_PATTERN.test(version)) {
    errors.push(`"version" inválida — use o formato semver (ex: "1.0.0") (recebido: ${JSON.stringify(data.version)}).`)
  }

  const entrypointRaw = typeof data.entrypoint === 'string' ? data.entrypoint.trim() : ''
  let entrypoint = ''
  if (!entrypointRaw || !entrypointRaw.endsWith('.js')) {
    errors.push('"entrypoint" é obrigatório e precisa terminar em ".js".')
  } else {
    const baseDir = resolve(pluginDir)
    const resolvedEntry = resolve(join(baseDir, entrypointRaw))
    if (resolvedEntry !== baseDir && !resolvedEntry.startsWith(baseDir + sep)) {
      errors.push(`"entrypoint" ("${entrypointRaw}") aponta para fora da pasta do plugin.`)
    } else if (!existsSync(resolvedEntry)) {
      errors.push(`"entrypoint" ("${entrypointRaw}") não existe em disco.`)
    } else {
      entrypoint = entrypointRaw
    }
  }

  let permissions: PluginPermission[] = []
  if (data.permissions !== undefined) {
    if (!Array.isArray(data.permissions)) {
      errors.push('"permissions" precisa ser uma lista de strings.')
    } else {
      const unknown = data.permissions.filter((p) => !isPluginPermission(p))
      if (unknown.length > 0) {
        errors.push(`permissão desconhecida: ${unknown.map((p) => JSON.stringify(p)).join(', ')}.`)
      }
      permissions = [...new Set(data.permissions.filter(isPluginPermission))].sort()
    }
  }

  let description: string | undefined
  if (data.description !== undefined) {
    if (typeof data.description !== 'string') {
      errors.push('"description", quando presente, precisa ser uma string.')
    } else {
      description = data.description
    }
  }

  let author: string | undefined
  if (data.author !== undefined) {
    if (typeof data.author !== 'string') {
      errors.push('"author", quando presente, precisa ser uma string.')
    } else {
      author = data.author
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    manifest: { id, name, version, entrypoint, permissions, description, author }
  }
}
