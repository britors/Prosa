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
  private startTime = Date.now()
  private initialWords = 0
  private readonly focusTimerEl: HTMLElement | null
  private goal = 0

  constructor(container: HTMLElement, editor: Editor, focusTimerEl: HTMLElement | null = null) {
    this.editor = editor
    this.el = container
    this.focusTimerEl = focusTimerEl
    this.initialWords = this.getWordCount()
  }

  /** Define a meta de palavras (0 desativa a barra de progresso). */
  setGoal(goal: number): void {
    this.goal = goal
    this.update()
  }

  /** Define o nome do documento exibido na barra. */
  setDocumentName(name: string): void {
    this.documentName = name
    this.update()
  }

  private getWordCount(): number {
    const json = this.editor.getJSON() as TipTapJSON
    return computeStats(documentText(json)).words
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
    
    // Estatísticas de Foco
    const elapsedMinutes = (Date.now() - this.startTime) / 60000
    const wpm = elapsedMinutes > 0 ? Math.round((stats.words - this.initialWords) / elapsedMinutes) : 0

    const dirtyMark = this.dirty ? '<span class="status-dirty">•</span>' : ''
    const goalBar = this.renderGoalBar(stats.words)
    this.el.innerHTML = `
      <span class="status-name">${dirtyMark}${this.documentName}</span>
      <span class="status-spacer"></span>
      <span title="Palavras">${nf.format(stats.words)} palavras</span>
      ${goalBar}
      <span title="Ritmo">${wpm} WPM</span>
      <span title="Tempo de foco">${Math.round(elapsedMinutes)} min</span>
      <span title="Páginas">${totalPages} pág.</span>
      <span title="Posição">Ln ${line}, Col ${col}</span>
      <span title="Zoom">${this.zoom}%</span>
    `
    if (this.focusTimerEl) this.el.appendChild(this.focusTimerEl)
  }

  /** Monta a barra de progresso da meta de palavras (vazio quando não há meta). */
  private renderGoalBar(words: number): string {
    if (this.goal <= 0) return ''
    const progress = Math.min(100, Math.round((words / this.goal) * 100))
    return `
      <span class="goal-bar" title="Meta: ${nf.format(this.goal)} palavras (${progress}%)">
        <span class="goal-bar-track"><span class="goal-bar-fill" style="width:${progress}%"></span></span>
      </span>
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
