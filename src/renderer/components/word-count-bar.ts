// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Editor } from '@tiptap/core'
import { computeStats } from '../../shared/document-utils.js'
import type { TipTapJSON } from '../../shared/types.js'
import { documentText } from '../../shared/document-utils.js'

/** Formata números no padrão pt-BR. */
const nf = new Intl.NumberFormat('pt-BR')

/** Altura aproximada (em caracteres) de uma página A4 para estimar páginas. */
const CHARS_PER_PAGE = 1800

/**
 * Barra de status inferior. Exibe contagens, tempo de leitura, páginas,
 * zoom, posição do cursor e o indicador de alterações não salvas.
 */
export class WordCountBar {
  private readonly editor: Editor
  private readonly el: HTMLElement
  private documentName = 'Sem título'
  private dirty = false
  private zoom = 100

  constructor(container: HTMLElement, editor: Editor) {
    this.editor = editor
    this.el = container
  }

  /** Define o nome do documento exibido na barra. */
  setDocumentName(name: string): void {
    this.documentName = name
    this.update()
  }

  /** Atualiza o indicador de alterações não salvas. */
  setDirty(dirty: boolean): void {
    this.dirty = dirty
    this.update()
  }

  /** Atualiza o nível de zoom exibido. */
  setZoom(zoom: number): void {
    this.zoom = zoom
    this.update()
  }

  /** Recalcula as estatísticas e redesenha a barra. */
  update(): void {
    const json = this.editor.getJSON() as TipTapJSON
    const text = documentText(json)
    const stats = computeStats(text)
    const totalPages = Math.max(1, Math.ceil(stats.characters / CHARS_PER_PAGE))
    const { line, col } = this.cursorPosition()

    const dirtyMark = this.dirty ? '<span class="status-dirty">•</span>' : ''
    this.el.innerHTML = `
      <span class="status-name">${dirtyMark}${this.documentName}</span>
      <span class="status-spacer"></span>
      <span title="Palavras">${nf.format(stats.words)} palavras</span>
      <span title="Caracteres">${nf.format(stats.characters)} caracteres</span>
      <span title="Sem espaços">${nf.format(stats.charactersNoSpaces)} sem espaços</span>
      <span title="Tempo de leitura">~${nf.format(stats.readingTimeMinutes)} min</span>
      <span title="Páginas">${totalPages} pág.</span>
      <span title="Posição">Ln ${line}, Col ${col}</span>
      <span title="Zoom">${this.zoom}%</span>
    `
  }

  /** Calcula a posição (linha, coluna) do cursor no documento. */
  private cursorPosition(): { line: number; col: number } {
    const { from } = this.editor.state.selection
    const textBefore = this.editor.state.doc.textBetween(0, from, '\n', '\n')
    const lines = textBefore.split('\n')
    return { line: lines.length, col: (lines[lines.length - 1]?.length ?? 0) + 1 }
  }
}
