// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AiProvider, ProsaSettings } from '../../shared/types.js'
import { AI_MODEL_OPTIONS, defaultAiModel } from '../../shared/ai-settings.js'
import { showAlert } from './app-dialogs.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export class AiSettingsDialog {
  private readonly overlay: HTMLElement

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  async show(): Promise<void> {
    const settings = await window.prosa.getSettings()
    const keyStatus = await window.prosa.getAiApiKeyStatus(settings.aiProvider)
    this.render(settings, keyStatus.configured, keyStatus.encryptionAvailable)
    this.overlay.hidden = false
  }

  private render(settings: ProsaSettings, keyConfigured: boolean, encryptionAvailable: boolean): void {
    const modelOptions = this.modelOptionsHtml(settings.aiProvider, settings.aiModel)
    this.overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Configurações de IA">
        <div class="modal-header">
          <h2>Configurações de IA</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <p class="format-card-desc">
          A IA fica desligada por padrão. Ao usar recursos de IA, o texto escolhido será enviado ao provedor configurado.
        </p>
        <div class="workspace-section">
          <label class="format-card-desc">
            <input id="ai-enabled" type="checkbox" ${settings.aiEnabled ? 'checked' : ''}>
            Ativar recursos de IA
          </label>
        </div>
        <div class="workspace-section">
          <div class="panel-title">Provedor</div>
          <select id="ai-provider" class="field-select">
            <option value="openai" ${settings.aiProvider === 'openai' ? 'selected' : ''}>OpenAI / ChatGPT</option>
            <option value="gemini" ${settings.aiProvider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
          </select>
        </div>
        <div class="workspace-section">
          <div class="panel-title">Modelo</div>
          <select id="ai-model" class="field-select">
            ${modelOptions}
          </select>
        </div>
        <div class="workspace-section">
          <div class="panel-title">Chave de API</div>
          <input id="ai-api-key" class="field-select" type="password" autocomplete="off" placeholder="${keyConfigured ? 'Chave configurada; preencha para substituir' : 'Cole a chave do provedor'}">
          <p class="format-card-desc">
            Status: ${keyConfigured ? 'chave configurada' : 'sem chave'}.
            ${encryptionAvailable ? 'A chave será salva no armazenamento seguro do sistema.' : 'Armazenamento seguro indisponível neste sistema.'}
          </p>
        </div>
        <div class="frontmatter-actions">
          <button id="btn-remove-ai-key" class="btn btn-ghost btn-sm" ${keyConfigured ? '' : 'disabled'}>Remover chave</button>
          <button id="btn-save-ai-settings" class="btn btn-primary">Salvar</button>
        </div>
      </div>
    `

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => (this.overlay.hidden = true))
    this.overlay.querySelector<HTMLSelectElement>('#ai-provider')?.addEventListener('change', async (event) => {
      const provider = (event.target as HTMLSelectElement).value as AiProvider
      const current = await window.prosa.getSettings()
      const status = await window.prosa.getAiApiKeyStatus(provider)
      this.render({ ...current, aiProvider: provider, aiModel: defaultAiModel(provider) }, status.configured, status.encryptionAvailable)
    })
    this.overlay.querySelector('#btn-remove-ai-key')?.addEventListener('click', async () => {
      const provider = this.getProvider()
      await window.prosa.removeAiApiKey(provider)
      await this.show()
    })
    this.overlay.querySelector('#btn-save-ai-settings')?.addEventListener('click', async () => {
      const provider = this.getProvider()
      const model = this.overlay.querySelector<HTMLSelectElement>('#ai-model')?.value.trim() ?? ''
      const enabled = this.overlay.querySelector<HTMLInputElement>('#ai-enabled')?.checked ?? false
      const apiKey = this.overlay.querySelector<HTMLInputElement>('#ai-api-key')?.value.trim() ?? ''

      try {
        if (apiKey) await window.prosa.setAiApiKey(provider, apiKey)
        await window.prosa.setSettings({
          aiEnabled: enabled,
          aiProvider: provider,
          aiModel: model || defaultAiModel(provider)
        })
        this.overlay.hidden = true
      } catch (error) {
        await showAlert(error instanceof Error ? error.message : String(error), 'Erro nas configurações de IA', 'danger')
      }
    })
  }

  private getProvider(): AiProvider {
    const value = this.overlay.querySelector<HTMLSelectElement>('#ai-provider')?.value
    return value === 'gemini' ? 'gemini' : 'openai'
  }

  private modelOptionsHtml(provider: AiProvider, currentModel: string): string {
    const options = AI_MODEL_OPTIONS[provider]
    const hasCurrent = options.some((option) => option.id === currentModel)
    const currentOption = hasCurrent || !currentModel.trim()
      ? ''
      : `<option value="${escapeHtml(currentModel)}" selected>${escapeHtml(currentModel)} (personalizado)</option>`
    return currentOption + options
      .map((option) => `
        <option value="${escapeHtml(option.id)}" ${option.id === currentModel || (!hasCurrent && option.id === defaultAiModel(provider) && !currentModel.trim()) ? 'selected' : ''}>
          ${escapeHtml(option.label)}
        </option>
      `)
      .join('')
  }
}
