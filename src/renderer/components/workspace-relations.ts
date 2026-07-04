// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { WorkspaceRelations } from '../../shared/types.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface WorkspaceRelationsCallbacks {
  onOpenDocument: (path: string) => void
}

export class WorkspaceRelationsPanel {
  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: WorkspaceRelationsCallbacks
  ) {}

  async update(path: string | null): Promise<void> {
    if (!path) {
      this.renderEmpty('Abra um documento para ver relações.')
      return
    }

    const relations = await window.prosa.getWorkspaceRelations(path)
    this.render(relations)
  }

  private renderEmpty(message: string): void {
    this.container.innerHTML = `
      <div class="note-panel">
        <div class="panel-title">Relações do workspace</div>
        <div class="panel-empty">${escapeHtml(message)}</div>
      </div>
    `
  }

  private render(relations: WorkspaceRelations): void {
    const backlinks = relations.backlinks
    const related = relations.related
    const brokenLinks = relations.brokenLinks

    this.container.innerHTML = `
      <div class="note-panel">
        <div class="panel-title">Relações do workspace</div>
        <div class="workspace-section">
          <div class="workspace-subtitle">Backlinks</div>
          ${
            backlinks.length > 0
              ? backlinks.map((item) => `<button class="workspace-mini-link" data-open-path="${escapeHtml(item.path)}"><span>${escapeHtml(item.title)}</span><span class="library-chip">${escapeHtml(item.format.toUpperCase())}</span></button>`).join('')
              : '<div class="panel-empty">Nenhum backlink encontrado.</div>'
          }
        </div>
        <div class="workspace-section">
          <div class="workspace-subtitle">Relacionados</div>
          ${
            related.length > 0
              ? related.map((item) => `<button class="workspace-mini-link" data-open-path="${escapeHtml(item.path)}"><span>${escapeHtml(item.title)}</span><span class="library-chip">${escapeHtml(item.format.toUpperCase())}</span></button>`).join('')
              : '<div class="panel-empty">Sem documentos relacionados.</div>'
          }
        </div>
        <div class="workspace-section">
          <div class="workspace-subtitle">Links quebrados</div>
          ${
            brokenLinks.length > 0
              ? brokenLinks.map((item) => `<div class="workspace-broken-link">${escapeHtml(item)}</div>`).join('')
              : '<div class="panel-empty">Nenhum link quebrado.</div>'
          }
        </div>
      </div>
    `

    this.container.querySelectorAll<HTMLElement>('[data-open-path]').forEach((item) => {
      item.addEventListener('click', () => {
        const openPath = item.dataset.openPath
        if (openPath) this.callbacks.onOpenDocument(openPath)
      })
    })
  }
}
