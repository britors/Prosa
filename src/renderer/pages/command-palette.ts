// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Editor } from '@tiptap/core'

export class CommandPalette {
  private readonly editor: Editor
  // @ts-ignore
  private readonly container: HTMLElement
  private element: HTMLElement | null = null
  private onOpenFile: (path: string) => void
  private onToggleTypewriter?: () => void
  private onToggleDistractionFree?: () => void
  private onDailyNote?: () => void
  private onCitation?: () => void
  private onGraph?: () => void
  private onTemplateManager?: () => void
  private onSearch?: () => void
  private onPluginManager?: () => void
  private onVersionHistory?: () => void
  private onFontProfiles?: () => void
  private onFrontmatter?: () => void

  constructor(container: HTMLElement, editor: Editor, onOpenFile: (path: string) => void, onToggleTypewriter?: () => void, onToggleDistractionFree?: () => void, onDailyNote?: () => void, onCitation?: () => void, onGraph?: () => void, onTemplateManager?: () => void, onSearch?: () => void, onPluginManager?: () => void, onVersionHistory?: () => void, onFontProfiles?: () => void, onFrontmatter?: () => void) {
    this.container = container
    this.editor = editor
    this.onOpenFile = onOpenFile
    this.onToggleTypewriter = onToggleTypewriter
    this.onToggleDistractionFree = onToggleDistractionFree
    this.onDailyNote = onDailyNote
    this.onCitation = onCitation
    this.onGraph = onGraph
    this.onTemplateManager = onTemplateManager
    this.onSearch = onSearch
    this.onPluginManager = onPluginManager
    this.onVersionHistory = onVersionHistory
    this.onFontProfiles = onFontProfiles
    this.onFrontmatter = onFrontmatter

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        this.show()
      }
    })
  }

  async show(): Promise<void> {
    if (this.element) return

    const recent = await window.prosa.getRecentFiles()
    const commands = [
        { label: 'Negrito', action: () => this.editor.commands.toggleBold() },
        { label: 'Itálico', action: () => this.editor.commands.toggleItalic() },
        { label: 'Sublinhado', action: () => this.editor.commands.toggleUnderline() },
        { label: 'Título 1', action: () => this.editor.commands.toggleHeading({ level: 1 }) },
        { label: 'Título 2', action: () => this.editor.commands.toggleHeading({ level: 2 }) },
        { label: 'Lista', action: () => this.editor.commands.toggleBulletList() },
        { label: 'Modo Máquina de Escrever', action: () => this.onToggleTypewriter?.() },
        { label: 'Modo Sem Distrações', action: () => this.onToggleDistractionFree?.() },
        { label: 'Nova Nota Diária', action: () => this.onDailyNote?.() },
        { label: 'Inserir Citação', action: () => this.onCitation?.() },
        { label: 'Visualizar Grafo', action: () => this.onGraph?.() },
        { label: 'Gerenciar Templates', action: () => this.onTemplateManager?.() },
        { label: 'Gerenciar Plugins', action: () => this.onPluginManager?.() },
        { label: 'Comparar Versões', action: () => this.onVersionHistory?.() },
        { label: 'Perfis de Fonte', action: () => this.onFontProfiles?.() },
        { label: 'Editar Frontmatter', action: () => this.onFrontmatter?.() },
        { label: 'Pesquisar no Workspace', action: () => this.onSearch?.() },
        ...recent.map(f => ({ label: `Abrir: ${f.name}`, action: () => this.onOpenFile(f.path) }))
    ]

    this.element = document.createElement('div')
    this.element.className = 'command-palette'
    this.element.setAttribute('role', 'dialog')
    this.element.setAttribute('aria-modal', 'true')
    this.element.setAttribute('aria-label', 'Paleta de comandos')
    this.element.innerHTML = `
      <input type="text" class="palette-input" placeholder="Comandos ou arquivos..." aria-label="Pesquisar comandos" aria-autocomplete="list" />
      <div class="palette-results" role="listbox" aria-label="Resultados da paleta"></div>
    `
    // ... rest of the logic unchanged


    const input = this.element.querySelector('input') as HTMLInputElement
    const results = this.element.querySelector('.palette-results') as HTMLElement

    let selectedIndex = 0

    const render = (query = '') => {
        const filtered = commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()))
        results.innerHTML = filtered
        .map((c, i) => `<div class="palette-item ${i === selectedIndex ? 'selected' : ''}" data-index="${i}" role="option" aria-selected="${i === selectedIndex}">${c.label}</div>`).join('')
        
        selectedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1))
        
        results.querySelectorAll('.palette-item').forEach(el => {
            el.addEventListener('click', () => {
                const index = parseInt((el as HTMLElement).dataset.index || '0')
                filtered[index].action()
                this.hide()
            })
        })
    }

    input.oninput = () => { selectedIndex = 0; render(input.value) }
    input.onkeydown = (e) => {
      const filtered = commands.filter(c => c.label.toLowerCase().includes(input.value.toLowerCase()))
      if (e.key === 'Escape') this.hide()
      else if (e.key === 'ArrowDown') {
        selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1)
        render(input.value)
      } else if (e.key === 'ArrowUp') {
        selectedIndex = Math.max(selectedIndex - 1, 0)
        render(input.value)
      } else if (e.key === 'Enter') {
        if (filtered.length > 0 && filtered[selectedIndex]) {
            filtered[selectedIndex].action()
            this.hide()
        }
      }
    }

    render()
    document.body.appendChild(this.element)
    input.focus()
  }

  hide(): void {
    if (this.element) {
      this.element.remove()
      this.element = null
      this.editor.commands.focus()
    }
  }
}
