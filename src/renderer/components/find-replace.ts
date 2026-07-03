// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Editor } from '@tiptap/core'
import type { SearchOptions } from '../editor/extensions/find-replace.js'

/**
 * Painel flutuante de Localizar & Substituir. Sincroniza o termo digitado
 * com a extensão FindReplace e expõe navegação e substituição.
 */
export class FindReplacePanel {
  private readonly editor: Editor
  private readonly root: HTMLElement
  private readonly findInput: HTMLInputElement
  private readonly replaceInput: HTMLInputElement
  private readonly counter: HTMLElement
  private readonly options: SearchOptions = {
    caseSensitive: false,
    wholeWord: false,
    regex: false
  }

  constructor(parent: HTMLElement, editor: Editor) {
    this.editor = editor
    this.root = document.createElement('div')
    this.root.className = 'find-replace-panel'
    this.root.setAttribute('role', 'search')
    this.root.setAttribute('aria-label', 'Localizar e substituir')
    this.root.hidden = true
    this.root.innerHTML = `
      <div class="fr-row">
        <input type="text" class="fr-find" placeholder="Localizar" aria-label="Localizar" />
        <span class="fr-counter" aria-live="polite">0/0</span>
        <button type="button" class="fr-btn fr-prev" title="Anterior" aria-label="Ocorrência anterior"><i class="ti ti-chevron-up"></i></button>
        <button type="button" class="fr-btn fr-next" title="Próxima" aria-label="Próxima ocorrência"><i class="ti ti-chevron-down"></i></button>
        <button type="button" class="fr-btn fr-close" title="Fechar" aria-label="Fechar localizar e substituir"><i class="ti ti-x"></i></button>
      </div>
      <div class="fr-row">
        <input type="text" class="fr-replace" placeholder="Substituir por" aria-label="Substituir por" />
        <button type="button" class="fr-btn fr-replace-one">Substituir</button>
        <button type="button" class="fr-btn fr-replace-all">Todas</button>
      </div>
      <div class="fr-row fr-options">
        <label><input type="checkbox" class="fr-case" /> Aa</label>
        <label><input type="checkbox" class="fr-word" /> Palavra</label>
        <label><input type="checkbox" class="fr-regex" /> .*</label>
      </div>
    `
    parent.appendChild(this.root)

    this.findInput = this.root.querySelector('.fr-find') as HTMLInputElement
    this.replaceInput = this.root.querySelector('.fr-replace') as HTMLInputElement
    this.counter = this.root.querySelector('.fr-counter') as HTMLElement

    this.wireEvents()
  }

  /** Liga os eventos dos campos e botões do painel. */
  private wireEvents(): void {
    this.findInput.addEventListener('input', () => this.runSearch())

    const bindOption = (selector: string, key: keyof SearchOptions): void => {
      const input = this.root.querySelector(selector) as HTMLInputElement
      input.addEventListener('change', () => {
        this.options[key] = input.checked
        this.runSearch()
      })
    }
    bindOption('.fr-case', 'caseSensitive')
    bindOption('.fr-word', 'wholeWord')
    bindOption('.fr-regex', 'regex')

    this.findInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        if (event.shiftKey) {
          this.editor.commands.findPrevious()
        } else {
          this.editor.commands.findNext()
        }
      } else if (event.key === 'Escape') {
        this.hide()
      }
    })

    ;(this.root.querySelector('.fr-prev') as HTMLElement).addEventListener('click', () =>
      this.editor.commands.findPrevious()
    )
    ;(this.root.querySelector('.fr-next') as HTMLElement).addEventListener('click', () =>
      this.editor.commands.findNext()
    )
    ;(this.root.querySelector('.fr-close') as HTMLElement).addEventListener('click', () =>
      this.hide()
    )
    ;(this.root.querySelector('.fr-replace-one') as HTMLElement).addEventListener(
      'click',
      () => {
        this.editor.commands.replaceCurrent(this.replaceInput.value)
        this.runSearch()
      }
    )
    ;(this.root.querySelector('.fr-replace-all') as HTMLElement).addEventListener(
      'click',
      () => {
        this.editor.commands.replaceAll(this.replaceInput.value)
        this.runSearch()
      }
    )
  }

  /** Reexecuta a busca com o termo e as opções atuais. */
  private runSearch(): void {
    this.editor.commands.setSearchTerm(this.findInput.value, this.options)
  }

  /** Atualiza o contador "atual/total" exibido no painel. */
  updateCounter(current: number, total: number): void {
    this.counter.textContent = `${current}/${total}`
  }

  /** Exibe o painel, opcionalmente mostrando os campos de substituição. */
  show(withReplace = false): void {
    this.root.hidden = false
    this.root.classList.toggle('show-replace', withReplace)
    this.findInput.focus()
    this.findInput.select()
    this.runSearch()
  }

  /** Oculta o painel e limpa o destaque de busca. */
  hide(): void {
    this.root.hidden = true
    this.editor.commands.clearSearch()
    this.editor.view.focus()
  }

  /** Indica se o painel está visível no momento. */
  get visible(): boolean {
    return !this.root.hidden
  }
}
