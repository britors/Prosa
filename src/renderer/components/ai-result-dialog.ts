// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface AiResultDialogOptions {
  title: string
  text: string
  applyLabel?: string
  onApply?: () => void
}

interface AiResultLoadingOptions {
  title: string
  message: string
}

interface AiResultErrorOptions {
  title: string
  message: string
}

export class AiResultDialog {
  private readonly overlay: HTMLElement

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  showLoading(options: AiResultLoadingOptions): void {
    this.overlay.innerHTML = `
      <div class="modal ai-result-dialog ai-loading-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(options.title)}">
        <div class="ai-loading-state" role="status" aria-live="polite">
          <div class="ai-loading-spinner" aria-hidden="true"></div>
          <div>
            <h2>${escapeHtml(options.title)}</h2>
            <p class="format-card-desc">${escapeHtml(options.message)}</p>
          </div>
        </div>
      </div>
    `
    this.overlay.hidden = false
  }

  showError(options: AiResultErrorOptions): void {
    this.overlay.innerHTML = `
      <div class="modal modal-wide ai-result-dialog ai-error-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(options.title)}">
        <div class="modal-header">
          <h2>${escapeHtml(options.title)}</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <div class="ai-error-state" role="alert" aria-live="assertive">
          <div class="ai-error-icon" aria-hidden="true"><i class="ti ti-alert-triangle"></i></div>
          <p class="ai-error-message">${escapeHtml(options.message)}</p>
        </div>
        <div class="app-dialog-actions">
          <button class="btn btn-primary" data-ai-result-close>Fechar</button>
        </div>
      </div>
    `

    const close = (): void => {
      this.overlay.hidden = true
    }

    this.overlay.querySelector('.modal-close')?.addEventListener('click', close)
    this.overlay.querySelector('[data-ai-result-close]')?.addEventListener('click', close)
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) close()
    })
    this.overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close()
    })

    this.overlay.hidden = false
  }

  show(options: AiResultDialogOptions): void {
    this.overlay.innerHTML = `
      <div class="modal modal-wide ai-result-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(options.title)}">
        <div class="modal-header">
          <h2>${escapeHtml(options.title)}</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <textarea class="ai-result-textarea" readonly>${escapeHtml(options.text)}</textarea>
        <div class="app-dialog-actions">
          <button class="btn btn-ghost" data-ai-result-close>Fechar</button>
          <button class="btn btn-secondary" data-ai-result-copy>Copiar</button>
          ${options.onApply ? `<button class="btn btn-primary" data-ai-result-apply>${escapeHtml(options.applyLabel ?? 'Aplicar')}</button>` : ''}
        </div>
      </div>
    `

    const close = (): void => {
      this.overlay.hidden = true
    }

    this.overlay.querySelector('.modal-close')?.addEventListener('click', close)
    this.overlay.querySelector('[data-ai-result-close]')?.addEventListener('click', close)
    this.overlay.querySelector('[data-ai-result-copy]')?.addEventListener('click', () => {
      void navigator.clipboard.writeText(options.text)
    })
    this.overlay.querySelector('[data-ai-result-apply]')?.addEventListener('click', () => {
      options.onApply?.()
      close()
    })
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) close()
    })
    this.overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close()
    })

    this.overlay.hidden = false
  }

  hide(): void {
    this.overlay.hidden = true
  }
}
