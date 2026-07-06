// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { safeStorage } from 'electron'
import Store from 'electron-store'
import type { AiApiKeyStatus, AiProvider } from '../shared/types.js'

interface StoredAiCredentials {
  apiKeys: Partial<Record<AiProvider, string>>
}

const credentialStore = new Store<StoredAiCredentials>({
  name: 'prosa-ai-credentials',
  defaults: { apiKeys: {} }
})

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encryptSecret(value: string): string {
  if (!canEncrypt()) {
    throw new Error('Armazenamento seguro indisponível neste sistema.')
  }
  return safeStorage.encryptString(value).toString('base64')
}

function getStoredKeys(): Partial<Record<AiProvider, string>> {
  return credentialStore.get('apiKeys', {})
}

export function hasAiApiKey(provider: AiProvider): boolean {
  return typeof getStoredKeys()[provider] === 'string'
}

export function getAiApiKeyStatus(provider: AiProvider): AiApiKeyStatus {
  return {
    provider,
    configured: hasAiApiKey(provider),
    encryptionAvailable: canEncrypt()
  }
}

export function setAiApiKey(provider: AiProvider, apiKey: string): AiApiKeyStatus {
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error('Informe uma chave de API válida.')

  credentialStore.set('apiKeys', {
    ...getStoredKeys(),
    [provider]: encryptSecret(trimmed)
  })
  return getAiApiKeyStatus(provider)
}

export function removeAiApiKey(provider: AiProvider): AiApiKeyStatus {
  const keys = { ...getStoredKeys() }
  delete keys[provider]
  credentialStore.set('apiKeys', keys)
  return getAiApiKeyStatus(provider)
}

export function getAiApiKey(provider: AiProvider): string | null {
  const encrypted = getStoredKeys()[provider]
  if (!encrypted) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    return null
  }
}
