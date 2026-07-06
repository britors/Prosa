// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

type DialogVariant = 'info' | 'warning' | 'danger'

interface DialogOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: DialogVariant
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function iconFor(variant: DialogVariant): string {
  if (variant === 'danger') return 'ti-alert-triangle'
  if (variant === 'warning') return 'ti-alert-circle'
  return 'ti-info-circle'
}

function showDialog(options: DialogOptions & { mode: 'alert' | 'confirm' }): Promise<boolean> {
  return new Promise((resolve) => {
    const variant = options.variant ?? (options.mode === 'confirm' ? 'warning' : 'info')
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay app-dialog-overlay'
    overlay.innerHTML = `
      <div class="modal app-dialog app-dialog-${variant}" role="dialog" aria-modal="true" aria-label="${escapeHtml(options.title)}">
        <div class="app-dialog-icon"><i class="ti ${iconFor(variant)}"></i></div>
        <div class="app-dialog-body">
          <div class="modal-header">
            <h2>${escapeHtml(options.title)}</h2>
            <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
          </div>
          <p class="app-dialog-message">${escapeHtml(options.message)}</p>
          <div class="app-dialog-actions">
            ${options.mode === 'confirm' ? `<button class="btn btn-ghost" data-dialog-cancel>${escapeHtml(options.cancelLabel ?? 'Cancelar')}</button>` : ''}
            <button class="btn btn-primary" data-dialog-confirm>${escapeHtml(options.confirmLabel ?? 'OK')}</button>
          </div>
        </div>
      </div>
    `

    const close = (value: boolean): void => {
      overlay.remove()
      resolve(value)
    }

    overlay.querySelector('[data-dialog-confirm]')?.addEventListener('click', () => close(true))
    overlay.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => close(false))
    overlay.querySelector('.modal-close')?.addEventListener('click', () => close(false))
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(false)
    })
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close(false)
      if (event.key === 'Enter') close(true)
    })

    document.body.appendChild(overlay)
    const primary = overlay.querySelector<HTMLButtonElement>('[data-dialog-confirm]')
    primary?.focus()
  })
}

export function showAlert(message: string, title = 'Prosa', variant: DialogVariant = 'info'): Promise<void> {
  return showDialog({ mode: 'alert', title, message, variant }).then(() => undefined)
}

export function showConfirm(
  message: string,
  title = 'Confirmar',
  variant: DialogVariant = 'warning',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar'
): Promise<boolean> {
  return showDialog({ mode: 'confirm', title, message, variant, confirmLabel, cancelLabel })
}
