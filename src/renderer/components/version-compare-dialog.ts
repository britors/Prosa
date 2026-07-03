// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { diffLines } from 'diff'
import { documentText } from '../../shared/document-utils.js'
import type { BackupVersion, TipTapJSON } from '../../shared/types.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface DiffRow {
  left: string | null
  right: string | null
  kind: 'same' | 'added' | 'removed'
}

/** Alinha os blocos de diffLines em linhas paralelas para exibição lado a lado. */
function buildRows(oldText: string, newText: string): DiffRow[] {
  const rows: DiffRow[] = []
  for (const part of diffLines(oldText, newText)) {
    const lines = part.value.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    for (const line of lines) {
      if (part.added) rows.push({ left: null, right: line, kind: 'added' })
      else if (part.removed) rows.push({ left: line, right: null, kind: 'removed' })
      else rows.push({ left: line, right: line, kind: 'same' })
    }
  }
  return rows
}

export class VersionCompareDialog {
  private readonly overlay: HTMLElement

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  async show(path: string | null, currentJson: TipTapJSON): Promise<void> {
    if (!path) {
      this.renderEmpty('Salve o documento para comparar versões.')
      this.overlay.hidden = false
      return
    }

    const versions = await window.prosa.listVersions(path)
    if (versions.length === 0) {
      this.renderEmpty('Nenhuma versão anterior encontrada.')
      this.overlay.hidden = false
      return
    }

    const currentText = documentText(currentJson)
    await this.renderCompare(path, versions, currentText)
    this.overlay.hidden = false
  }

  private renderEmpty(message: string): void {
    this.overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Comparar Versões">
        <div class="modal-header">
          <h2>Comparar Versões</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <p class="format-card-desc">${escapeHtml(message)}</p>
      </div>
    `
    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => (this.overlay.hidden = true))
  }

  private async renderCompare(path: string, versions: BackupVersion[], currentText: string): Promise<void> {
    this.overlay.innerHTML = `
      <div class="modal modal-wide" role="dialog" aria-label="Comparar Versões">
        <div class="modal-header">
          <h2>Comparar Versões</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <label class="field-label" for="version-select">Comparar documento atual com:</label>
        <select id="version-select" class="field-select">
          ${versions
            .map(
              (v) =>
                `<option value="${escapeHtml(v.file)}">${escapeHtml(new Date(v.modifiedAt).toLocaleString('pt-BR'))}</option>`
            )
            .join('')}
        </select>
        <div class="diff-columns" id="version-diff-output"></div>
      </div>
    `
    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => (this.overlay.hidden = true))

    const select = this.overlay.querySelector<HTMLSelectElement>('#version-select')
    const output = this.overlay.querySelector<HTMLElement>('#version-diff-output')
    if (!select || !output) return

    const renderDiff = async (): Promise<void> => {
      const oldText = await window.prosa.getVersionText(path, select.value)
      const rows = buildRows(oldText, currentText)
      const left = rows
        .map((r) => `<div class="diff-line${r.kind === 'removed' ? ' diff-line-removed' : ''}">${escapeHtml(r.left ?? '')}</div>`)
        .join('')
      const right = rows
        .map((r) => `<div class="diff-line${r.kind === 'added' ? ' diff-line-added' : ''}">${escapeHtml(r.right ?? '')}</div>`)
        .join('')
      output.innerHTML = `<div class="diff-column">${left}</div><div class="diff-column">${right}</div>`
    }

    select.addEventListener('change', () => void renderDiff())
    await renderDiff()
  }
}
