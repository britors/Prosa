// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

export interface Command {
  label: string
  action: () => void
}

export class CommandPalette {
  private readonly overlay: HTMLElement
  private commands: Command[] = []

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)

    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.hide()
    })
  }

  setCommands(commands: Command[]) {
    this.commands = commands
  }

  show() {
    this.render()
    this.overlay.hidden = false
    const input = this.overlay.querySelector('input')
    input?.focus()
  }

  hide() {
    this.overlay.hidden = true
  }

  private render() {
    this.overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Command Palette">
        <input type="text" placeholder="Digite um comando..." style="width: 100%; padding: 10px; background: var(--bg); border: 1px solid var(--border); color: white; border-radius: 6px; margin-bottom: 10px;">
        <div class="format-grid" id="command-list"></div>
      </div>
    `
    const list = this.overlay.querySelector('#command-list')!
    this.commands.forEach(cmd => {
      const btn = document.createElement('button')
      btn.className = 'format-card'
      btn.textContent = cmd.label
      btn.onclick = () => { cmd.action(); this.hide(); }
      list.appendChild(btn)
    })
    
    this.overlay.querySelector('input')?.addEventListener('input', (e) => {
        const val = (e.target as HTMLInputElement).value.toLowerCase()
        list.childNodes.forEach(node => {
            const btn = node as HTMLElement
            btn.hidden = !btn.textContent!.toLowerCase().includes(val)
        })
    })
  }
}
