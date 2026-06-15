/* Prosa — Editor de Texto
   Copyright (C) 2026 Rodrigo Brito
   SPDX-License-Identifier: GPL-3.0-or-later */

import type { UpdateStatus } from '../../shared/types.js'

/**
 * Componente de notificação de atualizações.
 * Gerencia o ciclo de vida da UI de update (aviso -> progresso -> reinício).
 */
export class UpdateNotification {
  private el: HTMLElement
  private status: UpdateStatus | null = null

  constructor() {
    this.el = document.createElement('div')
    this.el.className = 'update-notification'
    this.el.hidden = true
    document.body.appendChild(this.el)

    // Escuta eventos de status do processo main
    window.prosa.onUpdateStatus((status) => {
      this.status = status
      this.render()
    })
  }

  /**
   * Renderiza o conteúdo da notificação com base no status atual.
   */
  private render(): void {
    if (!this.status || this.status.state === 'up-to-date') {
      this.el.hidden = true
      return
    }

    this.el.hidden = false
    this.el.innerHTML = ''

    const content = document.createElement('div')
    content.className = 'update-content'

    const title = document.createElement('div')
    title.className = 'update-title'
    
    const actions = document.createElement('div')
    actions.className = 'update-actions'

    switch (this.status.state) {
      case 'available':
        title.innerHTML = `<i class="ti ti-download"></i> Nova versão disponível: <strong>${this.status.version}</strong>`
        
        const btnDownload = document.createElement('button')
        btnDownload.className = 'btn btn-primary btn-sm'
        btnDownload.textContent = 'Baixar agora'
        btnDownload.onclick = () => {
          void window.prosa.downloadUpdate()
          btnDownload.disabled = true
          btnDownload.textContent = 'Iniciando...'
        }
        
        const btnIgnore = document.createElement('button')
        btnIgnore.className = 'btn btn-ghost btn-sm'
        btnIgnore.textContent = 'Depois'
        btnIgnore.onclick = () => (this.el.hidden = true)

        actions.appendChild(btnDownload)
        actions.appendChild(btnIgnore)
        break

      case 'downloading':
        const percent = Math.round(this.status.percent || 0)
        title.innerHTML = `<i class="ti ti-loader-2 ti-spin"></i> Baixando atualização... ${percent}%`
        
        const progressContainer = document.createElement('div')
        progressContainer.className = 'update-progress-bar'
        const progressBar = document.createElement('div')
        progressBar.className = 'update-progress-fill'
        progressBar.style.width = `${percent}%`
        progressContainer.appendChild(progressBar)
        content.appendChild(progressContainer)
        break

      case 'downloaded':
        title.innerHTML = `<i class="ti ti-circle-check"></i> Atualização pronta para instalar!`
        
        const btnInstall = document.createElement('button')
        btnInstall.className = 'btn btn-primary btn-sm'
        btnInstall.textContent = 'Reiniciar e Instalar'
        btnInstall.onclick = () => window.prosa.installUpdate()

        actions.appendChild(btnInstall)
        break

      case 'error':
        title.innerHTML = `<i class="ti ti-alert-triangle"></i> Erro ao atualizar`
        const msg = document.createElement('div')
        msg.className = 'update-message'
        msg.textContent = this.status.message || 'Erro desconhecido'
        content.appendChild(msg)

        const btnClose = document.createElement('button')
        btnClose.className = 'btn btn-ghost btn-sm'
        btnClose.textContent = 'Fechar'
        btnClose.onclick = () => (this.el.hidden = true)
        actions.appendChild(btnClose)
        break

      case 'checking':
        title.innerHTML = `<i class="ti ti-loader-2 ti-spin"></i> Verificando atualizações...`
        break
    }

    content.prepend(title)
    this.el.appendChild(content)
    if (actions.hasChildNodes()) {
      this.el.appendChild(actions)
    }
  }
}
