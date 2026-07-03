// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

/** Toast exibido quando o documento aberto é alterado externamente pela sincronização. */
export class SyncNotification {
  private readonly el: HTMLElement

  constructor(parent: HTMLElement = document.body) {
    this.el = document.createElement('div')
    this.el.className = 'update-notification'
    this.el.hidden = true
    parent.appendChild(this.el)
  }

  show(fileName: string, onReload: () => void): void {
    this.el.innerHTML = ''

    const content = document.createElement('div')
    content.className = 'update-content'

    const title = document.createElement('div')
    title.className = 'update-title'
    title.innerHTML = `<i class="ti ti-refresh-alert"></i> "${fileName}" foi alterado pela sincronização.`
    content.appendChild(title)

    const actions = document.createElement('div')
    actions.className = 'update-actions'

    const btnReload = document.createElement('button')
    btnReload.className = 'btn btn-primary btn-sm'
    btnReload.textContent = 'Recarregar'
    btnReload.onclick = () => {
      this.hide()
      onReload()
    }

    const btnIgnore = document.createElement('button')
    btnIgnore.className = 'btn btn-ghost btn-sm'
    btnIgnore.textContent = 'Ignorar'
    btnIgnore.onclick = () => this.hide()

    actions.appendChild(btnReload)
    actions.appendChild(btnIgnore)

    this.el.appendChild(content)
    this.el.appendChild(actions)
    this.el.hidden = false
  }

  hide(): void {
    this.el.hidden = true
  }
}
