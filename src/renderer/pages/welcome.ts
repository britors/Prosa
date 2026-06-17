// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { RecentFile } from '../../shared/types.js'

/** Formata uma data ISO no padrão pt-BR. */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  } catch {
    return ''
  }
}

/** Callbacks acionados pela tela de boas-vindas. */
export interface WelcomeCallbacks {
  onNew: () => void
  onOpen: () => void
  onOpenRecent: (path: string) => void
  onPin: (file: RecentFile) => void
  onUnpin: (path: string) => void
}

/**
 * Tela de boas-vindas exibida quando nenhum documento está aberto. Mostra
 * logo, ações principais, arquivos recentes e uma zona de drag-and-drop.
 */
export class WelcomeScreen {
  private readonly root: HTMLElement
  private readonly callbacks: WelcomeCallbacks

  constructor(root: HTMLElement, callbacks: WelcomeCallbacks) {
    this.root = root
    this.callbacks = callbacks
  }

  /** Renderiza a tela com a lista de arquivos recentes e fixados informada. */
  render(recent: RecentFile[], pinned: RecentFile[]): void {
    this.root.innerHTML = `
      <div class="welcome">
        <div class="welcome-hero">
          <img class="welcome-logo-img" src="assets/prosa-logo.png" alt="Prosa" />
          <p class="welcome-tagline">Escreva. Formate. Publique.</p>
          <div class="welcome-actions">
            <button class="btn btn-primary" id="welcome-new">
              <i class="ti ti-file-plus"></i> Novo documento
            </button>
            <button class="btn btn-secondary" id="welcome-open">
              <i class="ti ti-folder-open"></i> Abrir arquivo
            </button>
          </div>
        </div>
        <div class="welcome-recent">
          ${pinned.length > 0 ? `<h2>Fixados</h2>${this.renderList(pinned, true)}` : ''}
          <h2>Arquivos recentes</h2>
          ${this.renderList(recent, false)}
        </div>
        <div class="welcome-dropzone" id="welcome-dropzone">
          <i class="ti ti-cloud-upload"></i>
          <span>Arraste um arquivo aqui para abrir</span>
        </div>
      </div>
    `

    this.root.querySelector('#welcome-new')?.addEventListener('click', () =>
      this.callbacks.onNew()
    )
    this.root.querySelector('#welcome-open')?.addEventListener('click', () =>
      this.callbacks.onOpen()
    )
    this.root.querySelectorAll('.recent-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement
        if (target.closest('.btn-pin')) return // Ignora clique no botão pin
        const path = (item as HTMLElement).dataset.path
        if (path) this.callbacks.onOpenRecent(path)
      })
    })
    this.root.querySelectorAll('.btn-pin').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const item = (btn as HTMLElement).closest('.recent-item') as HTMLElement
        const path = item.dataset.path!
        const name = item.dataset.name!
        const modifiedAt = item.dataset.modifiedAt!
        if (btn.classList.contains('ti-pin')) {
            this.callbacks.onPin({ path, name, modifiedAt })
        } else {
            this.callbacks.onUnpin(path)
        }
      })
    })
  }

  /** Renderiza uma lista de arquivos. */
  private renderList(files: RecentFile[], isPinned: boolean): string {
    if (files.length === 0) {
      return '<p class="welcome-empty">Nenhum arquivo.</p>'
    }
    return `<ul class="recent-list">${files
      .map(
        (file) => `
        <li class="recent-item" data-path="${file.path}" data-name="${file.name}" data-modified-at="${file.modifiedAt}">
          <i class="ti ${isPinned ? 'ti-pin-filled' : 'ti-file-text'}"></i>
          <div class="recent-info">
            <span class="recent-name">${file.name}</span>
            <span class="recent-path">${file.path}</span>
          </div>
          <button class="btn-pin ti ${isPinned ? 'ti-pin-off' : 'ti-pin'}"></button>
          <span class="recent-date">${formatDate(file.modifiedAt)}</span>
        </li>`
      )
      .join('')}</ul>`
  }

  /** Exibe a tela de boas-vindas. */
  show(): void {
    this.root.hidden = false
  }

  /** Oculta a tela de boas-vindas. */
  hide(): void {
    this.root.hidden = true
  }
}
