// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { PdfPreset } from '../../shared/types.js'

interface PdfPresetOption {
  preset: PdfPreset
  icon: string
  title: string
  description: string
}

const PRESETS: PdfPresetOption[] = [
  {
    preset: 'academic',
    icon: 'school',
    title: 'Acadêmico',
    description: 'A4, margens generosas e fundo impresso para trabalhos formais.'
  },
  {
    preset: 'report',
    icon: 'file-text',
    title: 'Relatório executivo',
    description: 'Letter, leitura leve e margens equilibradas para relatórios.'
  },
  {
    preset: 'contract',
    icon: 'file-certificate',
    title: 'Contrato',
    description: 'Legal, margens compactas e fundo desativado para documentos jurídicos.'
  },
  {
    preset: 'book',
    icon: 'book-2',
    title: 'Livro',
    description: 'A4, margens mais amplas e paginação contínua para textos longos.'
  }
]

export class PdfPresetDialog {
  private readonly overlay: HTMLElement
  private resolve: ((preset: PdfPreset | null) => void) | null = null

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  choose(current: PdfPreset): Promise<PdfPreset | null> {
    this.render(current)
    this.overlay.hidden = false
    return new Promise((resolve) => {
      this.resolve = resolve
    })
  }

  private render(current: PdfPreset): void {
    this.overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Escolher preset de PDF">
        <div class="modal-header">
          <h2>Exportar PDF</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <p class="modal-subtitle">Escolha um perfil de paginação antes de gerar o arquivo.</p>
        <div class="format-grid">
          ${PRESETS.map(
            (opt) => `
            <button class="format-card" data-preset="${opt.preset}" data-current="${opt.preset === current}">
              <i class="ti ti-${opt.icon}"></i>
              <div class="format-card-body">
                <span class="format-card-title">${opt.title}</span>
                <span class="format-card-desc">${opt.description}</span>
              </div>
            </button>`
          ).join('')}
        </div>
      </div>
    `

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => this.close(null))
    this.overlay.querySelectorAll<HTMLElement>('.format-card').forEach((card) => {
      card.addEventListener('click', () => this.close((card.dataset.preset as PdfPreset) ?? null))
    })
  }

  private close(preset: PdfPreset | null): void {
    this.overlay.hidden = true
    this.resolve?.(preset)
    this.resolve = null
  }
}
