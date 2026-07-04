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

export interface AbntTemplateData {
  title: string
  subtitle: string
  author: string
  institution: string
  course: string
  advisor: string
  city: string
  year: string
  summary: string
  keywords: string
}

const DEFAULTS: AbntTemplateData = {
  title: 'Trabalho acadêmico',
  subtitle: 'Subtítulo opcional',
  author: 'Seu nome',
  institution: 'Sua instituição',
  course: 'Seu curso',
  advisor: 'Nome do orientador',
  city: 'Sua cidade',
  year: String(new Date().getFullYear()),
  summary: 'Resumo do trabalho...',
  keywords: 'ABNT, acadêmico, TCC'
}

export class AbntDialog {
  private readonly overlay: HTMLElement
  private resolve: ((data: AbntTemplateData | null) => void) | null = null

  constructor(parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  choose(initial: Partial<AbntTemplateData> = {}): Promise<AbntTemplateData | null> {
    const data = { ...DEFAULTS, ...initial }
    this.render(data)
    this.overlay.hidden = false
    return new Promise((resolve) => {
      this.resolve = resolve
    })
  }

  private render(data: AbntTemplateData): void {
    this.overlay.innerHTML = `
      <div class="modal abnt-dialog" role="dialog" aria-label="Configurar trabalho ABNT">
        <div class="modal-header">
          <h2>Trabalho acadêmico</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <p class="modal-subtitle">Defina os blocos iniciais do modelo acadêmico.</p>
        <div class="abnt-grid">
          ${this.field('title', 'Título', data.title)}
          ${this.field('subtitle', 'Subtítulo', data.subtitle)}
          ${this.field('author', 'Autor', data.author)}
          ${this.field('institution', 'Instituição', data.institution)}
          ${this.field('course', 'Curso', data.course)}
          ${this.field('advisor', 'Orientador', data.advisor)}
          ${this.field('city', 'Cidade', data.city)}
          ${this.field('year', 'Ano', data.year)}
        </div>
        <label class="field-label" for="abnt-summary">Resumo</label>
        <textarea id="abnt-summary" class="abnt-textarea">${escapeHtml(data.summary)}</textarea>
        <label class="field-label" for="abnt-keywords">Palavras-chave</label>
        <input id="abnt-keywords" class="field-select" type="text" value="${escapeHtml(data.keywords)}" />
        <div class="frontmatter-actions">
          <button class="btn btn-secondary modal-cancel">Cancelar</button>
          <button class="btn btn-primary" id="abnt-create">Criar documento</button>
        </div>
      </div>
    `

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => this.close(null))
    this.overlay.querySelector('.modal-cancel')?.addEventListener('click', () => this.close(null))
    this.overlay.querySelector('#abnt-create')?.addEventListener('click', () => {
      const pick = (id: string): string => {
        const node = this.overlay.querySelector<HTMLInputElement>(`#${id}`)
        return node?.value.trim() ?? ''
      }
      const text = this.overlay.querySelector<HTMLTextAreaElement>('#abnt-summary')?.value.trim() ?? ''
      this.close({
        title: pick('abnt-title') || DEFAULTS.title,
        subtitle: pick('abnt-subtitle'),
        author: pick('abnt-author') || DEFAULTS.author,
        institution: pick('abnt-institution') || DEFAULTS.institution,
        course: pick('abnt-course') || DEFAULTS.course,
        advisor: pick('abnt-advisor') || DEFAULTS.advisor,
        city: pick('abnt-city') || DEFAULTS.city,
        year: pick('abnt-year') || DEFAULTS.year,
        summary: text || DEFAULTS.summary,
        keywords: pick('abnt-keywords') || DEFAULTS.keywords
      })
    })
  }

  private field(id: string, label: string, value: string): string {
    return `
      <label class="field-label" for="abnt-${id}">${label}</label>
      <input id="abnt-${id}" class="field-select" type="text" value="${escapeHtml(value)}" />
    `
  }

  private close(data: AbntTemplateData | null): void {
    this.overlay.hidden = true
    this.resolve?.(data)
    this.resolve = null
  }
}
