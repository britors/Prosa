// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { BUILTIN_FONT_PROFILES } from './font-profiles.js'
import type { FontProfile } from '../../shared/types.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export class FontProfileDialog {
  private readonly overlay: HTMLElement
  private activeId = 'serif'
  private custom: FontProfile[] = []
  private onApply: (profile: FontProfile) => void = () => {}

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  async show(activeId: string, onApply: (profile: FontProfile) => void): Promise<void> {
    this.activeId = activeId
    this.onApply = onApply
    const settings = await window.prosa.getSettings()
    this.custom = settings.fontProfiles
    const fonts = await window.prosa.getSystemFonts()
    this.render(fonts)
    this.overlay.hidden = false
  }

  private render(fonts: string[]): void {
    const profiles = [...BUILTIN_FONT_PROFILES, ...this.custom]
    const cards = profiles
      .map((p) => {
        const isBuiltin = BUILTIN_FONT_PROFILES.some((b) => b.id === p.id)
        return `
          <div class="format-card" data-profile="${escapeHtml(p.id)}" data-current="${p.id === this.activeId}">
            <i class="ti ti-typography"></i>
            <div class="format-card-body">
              <span class="format-card-title">${escapeHtml(p.name)}</span>
              <span class="format-card-desc">${escapeHtml(p.fontFamily)} · ${p.fontSize}pt · ${p.lineHeight}</span>
            </div>
            ${isBuiltin ? '' : `<i class="ti ti-trash btn-delete" data-id="${escapeHtml(p.id)}" title="Excluir"></i>`}
          </div>`
      })
      .join('')

    const fontOptions = fonts.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('')

    this.overlay.innerHTML = `
      <div class="modal modal-wide" role="dialog" aria-label="Perfis de Fonte">
        <div class="modal-header">
          <h2>Perfis de Fonte</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <div class="format-grid">${cards}</div>
        <label class="field-label" for="new-profile-name">Criar novo perfil</label>
        <div class="new-profile-form">
          <input type="text" id="new-profile-name" class="field-select" placeholder="Nome do perfil">
          <select id="new-profile-font" class="field-select">${fontOptions}</select>
          <input type="number" id="new-profile-size" class="field-select" placeholder="Tamanho (pt)" value="12" min="6" max="72">
          <input type="number" id="new-profile-line-height" class="field-select" placeholder="Altura de linha" value="1.6" min="1" max="3" step="0.1">
          <button id="btn-create-profile" class="btn btn-primary">Salvar perfil</button>
        </div>
      </div>
    `

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => (this.overlay.hidden = true))

    this.overlay.querySelectorAll<HTMLElement>('.format-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.profile
        if (!id) return
        const profile = profiles.find((p) => p.id === id)
        if (profile) {
          this.activeId = id
          this.onApply(profile)
          this.render(fonts)
        }
      })
    })

    this.overlay.querySelectorAll<HTMLElement>('.btn-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const id = btn.dataset.id
        if (!id) return
        this.custom = await window.prosa.deleteFontProfile(id)
        this.render(fonts)
      })
    })

    this.overlay.querySelector('#btn-create-profile')?.addEventListener('click', () => void this.createProfile(fonts))
  }

  private async createProfile(fonts: string[]): Promise<void> {
    const name = (this.overlay.querySelector('#new-profile-name') as HTMLInputElement)?.value.trim()
    const fontFamily = (this.overlay.querySelector('#new-profile-font') as HTMLSelectElement)?.value
    const fontSize = Number((this.overlay.querySelector('#new-profile-size') as HTMLInputElement)?.value)
    const lineHeight = Number((this.overlay.querySelector('#new-profile-line-height') as HTMLInputElement)?.value)

    if (!name || !fontFamily || !Number.isFinite(fontSize) || !Number.isFinite(lineHeight)) {
      window.alert('Preencha nome, fonte, tamanho e altura de linha para salvar o perfil.')
      return
    }

    this.custom = await window.prosa.saveFontProfile({ name, fontFamily, fontSize, lineHeight })
    this.render(fonts)
  }
}
