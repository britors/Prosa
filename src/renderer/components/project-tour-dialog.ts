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

interface TourStep {
  title: string
  description: string
  icon: string
  hint: string
  actionLabel?: string
  action?: () => void
}

interface ProjectTourCallbacks {
  onNewDocument: () => void
  onNewAbnt: () => void
  onOpenLibrary: () => void
  onOpenAiSettings: () => void
  onOpenCommandPalette: () => void
}

export class ProjectTourDialog {
  private readonly overlay: HTMLElement
  private resolve: (() => void) | null = null
  private stepIndex = 0

  constructor(
    private readonly callbacks: ProjectTourCallbacks,
    parent: HTMLElement = document.body
  ) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    this.overlay.addEventListener('keydown', this.handleKeydown)
    parent.appendChild(this.overlay)
  }

  async show(): Promise<void> {
    this.stepIndex = 0
    this.render()
    this.overlay.hidden = false
    return new Promise((resolve) => {
      this.resolve = resolve
    })
  }

  hide(): void {
    this.overlay.hidden = true
    this.overlay.innerHTML = ''
    this.resolve?.()
    this.resolve = null
  }

  private get steps(): TourStep[] {
    return [
      {
        icon: 'ti-feather',
        title: 'A história de Prosi',
        description:
          'Prosi nasceu da primeira página em branco que alguém decidiu preencher. Desde então, vive entre palavras, ideias e histórias, ajudando pessoas a transformar pensamentos em textos claros, elegantes e naturais. Sua pena azul não cria ideias do nada — ela revela o melhor daquilo que você já queria dizer.',
        hint: 'Ele acompanha o tour para apresentar a proposta do Prosa.'
      },
      {
        icon: 'ti-layout-dashboard',
        title: 'Comece pela tela inicial com o Prosi',
        description:
          'Use a tela de boas-vindas para criar um documento, abrir um arquivo, acessar a biblioteca do workspace e retomar recentes. O Prosi está ali para te acompanhar nesse início.',
        hint: 'Esse é o ponto de partida para a maioria dos fluxos.',
        actionLabel: 'Novo documento',
        action: this.callbacks.onNewDocument
      },
      {
        icon: 'ti-edit',
        title: 'Escreva no editor',
        description:
          'O editor ocupa o centro da interface. Nele você formata texto, trabalha com tabelas, usa notas e controla a estrutura do documento.',
        hint: 'O painel lateral acompanha tópicos, estilos e relações.'
      },
      {
        icon: 'ti-list-details',
        title: 'Use os painéis laterais',
        description:
          'O outline ajuda na navegação, os estilos aceleram a formatação e as notas e relações dão contexto ao texto sem sair da tela.',
        hint: 'Esses painéis podem ser ligados e desligados no menu Exibir.',
        actionLabel: 'Abrir biblioteca',
        action: this.callbacks.onOpenLibrary
      },
      {
        icon: 'ti-sparkles',
        title: 'Acione a IA quando fizer sentido',
        description:
          'O assistente de IA fica no painel lateral e trabalha sobre seleção ou documento inteiro, sempre com confirmação explícita.',
        hint: 'As configurações de IA ficam no editor e no menu Editar.',
        actionLabel: 'Configurar IA',
        action: this.callbacks.onOpenAiSettings
      },
      {
        icon: 'ti-books',
        title: 'Organize bibliografia e citações',
        description:
          'A biblioteca do workspace centraliza entradas BibTeX, estilo bibliográfico e citações usadas no texto.',
        hint: 'Esse fluxo alimenta os comandos de revisão bibliográfica.'
      },
      {
        icon: 'ti-rocket',
        title: 'Finalize e exporte',
        description:
          'Quando o texto estiver pronto, exporte em PDF, HTML limpo ou EPUB. Use a paleta de comandos para atalhos mais profundos.',
        hint: 'A paleta é útil para ações recorrentes e menos óbvias.',
        actionLabel: 'Paleta de comandos',
        action: this.callbacks.onOpenCommandPalette
      }
    ]
  }

  private render(): void {
    const step = this.steps[this.stepIndex] ?? this.steps[0]
    const progress = `${this.stepIndex + 1}/${this.steps.length}`

    this.overlay.innerHTML = `
      <div class="modal tour-dialog" role="dialog" aria-modal="true" aria-label="Tour do projeto">
        <div class="modal-header">
          <h2>Tour do projeto</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <div class="tour-intro">
          <img class="tour-portrait" src="assets/prosi_tour.png" alt="Prosi" />
          <div class="tour-intro-copy">
            <p class="modal-subtitle">Percurso rápido pelos pontos centrais do Prosa, guiado pelo Prosi.</p>
            <p class="tour-intro-caption">Uma única versão do personagem acompanha o tour inteiro.</p>
          </div>
        </div>
        <div class="tour-progress">
          <span class="tour-step-count">${progress}</span>
          <div class="tour-progress-bar" aria-hidden="true">
            <div class="tour-progress-fill" style="width: ${(this.stepIndex + 1) / this.steps.length * 100}%"></div>
          </div>
        </div>
        <div class="tour-card">
          <div class="tour-card-icon"><i class="ti ${step.icon}"></i></div>
          <div class="tour-card-body">
            <div class="tour-card-title">${escapeHtml(step.title)}</div>
            <p class="tour-card-description">${escapeHtml(step.description)}</p>
            <p class="tour-card-hint">${escapeHtml(step.hint)}</p>
          </div>
        </div>
        <div class="tour-actions">
          ${step.actionLabel ? `<button class="btn btn-secondary" id="tour-action">${escapeHtml(step.actionLabel)}</button>` : ''}
          <div class="tour-nav">
            <button class="btn btn-ghost" id="tour-back" ${this.stepIndex === 0 ? 'disabled' : ''}>Voltar</button>
            <button class="btn btn-primary" id="tour-next">${this.stepIndex === this.steps.length - 1 ? 'Concluir' : 'Próximo'}</button>
          </div>
        </div>
      </div>
    `

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => this.hide())
    this.overlay.querySelector('#tour-back')?.addEventListener('click', () => {
      this.stepIndex = Math.max(0, this.stepIndex - 1)
      this.render()
    })
    this.overlay.querySelector('#tour-next')?.addEventListener('click', () => {
      if (this.stepIndex >= this.steps.length - 1) {
        this.hide()
        return
      }
      this.stepIndex += 1
      this.render()
    })
    this.overlay.querySelector('#tour-action')?.addEventListener('click', () => {
      step.action?.()
    })

  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.hide()
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      if (this.stepIndex < this.steps.length - 1) {
        this.stepIndex += 1
        this.render()
      } else {
        this.hide()
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      this.stepIndex = Math.max(0, this.stepIndex - 1)
      this.render()
    }
  }
}
