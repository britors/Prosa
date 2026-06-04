// Prosa — Editor de Texto
// Copyright (C) 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
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

  /** Renderiza a tela com a lista de arquivos recentes informada. */
  render(recent: RecentFile[]): void {
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
          <h2>Arquivos recentes</h2>
          ${this.renderRecent(recent)}
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
      item.addEventListener('click', () => {
        const path = (item as HTMLElement).dataset.path
        if (path) this.callbacks.onOpenRecent(path)
      })
    })
  }

  /** Renderiza a lista de arquivos recentes (ou um estado vazio). */
  private renderRecent(recent: RecentFile[]): string {
    if (recent.length === 0) {
      return '<p class="welcome-empty">Nenhum arquivo recente ainda.</p>'
    }
    return `<ul class="recent-list">${recent
      .map(
        (file) => `
        <li class="recent-item" data-path="${file.path}">
          <i class="ti ti-file-text"></i>
          <div class="recent-info">
            <span class="recent-name">${file.name}</span>
            <span class="recent-path">${file.path}</span>
          </div>
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
