// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { FileFormat } from '../../shared/types.js'

/** Opção de formato exibida no seletor de salvamento. */
interface FormatOption {
  format: FileFormat
  icon: string
  label: string
  ext: string
  description: string
}

/** Formatos disponíveis para gravação, na ordem de exibição. */
const SAVE_FORMATS: FormatOption[] = [
  {
    format: 'prosa',
    icon: 'file-text',
    label: 'Documento Prosa',
    ext: '.prosa',
    description: 'Formato nativo — preserva tudo com fidelidade total.'
  },
  {
    format: 'docx',
    icon: 'brand-office',
    label: 'Word',
    ext: '.docx',
    description: 'Microsoft Word — compatível com o Office.'
  },
  {
    format: 'odt',
    icon: 'file-typography',
    label: 'OpenDocument',
    ext: '.odt',
    description: 'LibreOffice / OpenOffice Writer.'
  },
  {
    format: 'rtf',
    icon: 'file-description',
    label: 'Rich Text',
    ext: '.rtf',
    description: 'Texto formatado — lido por Word e LibreOffice.'
  },
  {
    format: 'md',
    icon: 'markdown',
    label: 'Markdown',
    ext: '.md',
    description: 'Texto com marcação simples (.md).'
  },
  {
    format: 'txt',
    icon: 'file',
    label: 'Texto puro',
    ext: '.txt',
    description: 'Sem formatação.'
  }
]

/**
 * Modal de seleção de formato exibido ao salvar. Resolve com o formato
 * escolhido ou `null` se o usuário cancelar.
 */
export class FormatDialog {
  private readonly overlay: HTMLElement
  private resolve: ((format: FileFormat | null) => void) | null = null

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)

    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.close(null)
    })
    document.addEventListener('keydown', (event) => {
      if (!this.overlay.hidden && event.key === 'Escape') {
        event.preventDefault()
        this.close(null)
      }
    })
  }

  /** Abre o seletor e devolve o formato escolhido (ou null). */
  choose(current?: FileFormat): Promise<FileFormat | null> {
    this.render(current)
    this.overlay.hidden = false
    return new Promise((resolve) => {
      this.resolve = resolve
    })
  }

  /** Renderiza os cartões de formato. */
  private render(current?: FileFormat): void {
    this.overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Escolher formato">
        <div class="modal-header">
          <h2>Salvar como</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <p class="modal-subtitle">Escolha o formato do arquivo:</p>
        <div class="format-grid">
          ${SAVE_FORMATS.map(
            (opt) => `
            <button class="format-card" data-format="${opt.format}" data-current="${
              opt.format === current
            }">
              <i class="ti ti-${opt.icon}"></i>
              <div class="format-card-body">
                <span class="format-card-title">${opt.label}
                  <span class="format-card-ext">${opt.ext}</span>
                </span>
                <span class="format-card-desc">${opt.description}</span>
              </div>
            </button>`
          ).join('')}
        </div>
      </div>
    `

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () =>
      this.close(null)
    )
    this.overlay.querySelectorAll<HTMLElement>('.format-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.close((card.dataset.format as FileFormat) ?? null)
      })
    })
    // Foca o formato atual (ou o primeiro) para navegação por teclado.
    const focusTarget =
      this.overlay.querySelector<HTMLElement>('.format-card[data-current="true"]') ??
      this.overlay.querySelector<HTMLElement>('.format-card')
    focusTarget?.focus()
  }

  /** Fecha o modal e resolve a Promise pendente. */
  private close(format: FileFormat | null): void {
    this.overlay.hidden = true
    this.resolve?.(format)
    this.resolve = null
  }
}
