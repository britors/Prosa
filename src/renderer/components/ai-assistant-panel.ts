// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Editor } from '@tiptap/core'
import type { AiWritingAction, BibliographyEntry, TipTapJSON, WorkspaceLibraryData } from '../../shared/types.js'
import { MAX_AI_INPUT_CHARS } from '../../shared/ai-actions.js'
import { AI_TRANSLATION_LANGUAGES } from '../../shared/ai-languages.js'
import { AI_TONE_OPTIONS } from '../../shared/ai-tones.js'
import { extractCitations } from '../../shared/document-utils.js'
import { showAlert, showConfirm } from './app-dialogs.js'
import { AiResultDialog } from './ai-result-dialog.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type DocumentAiAction = Extract<
  AiWritingAction,
  | 'summarize'
  | 'generateAbstract'
  | 'generateIntroduction'
  | 'generateConclusion'
  | 'extractKeywords'
  | 'suggestTitles'
  | 'mainPoints'
  | 'analyzeIssues'
  | 'reviewToneConsistency'
  | 'standardizeLanguage'
  | 'flagWeakPassages'
  | 'suggestArgumentExpansion'
  | 'checkVerbPersonConsistency'
  | 'suggestStructure'
  | 'compareOutline'
  | 'suggestSectionBreakdown'
  | 'detectLongSections'
  | 'suggestTransitions'
  | 'reorganizeIdeas'
  | 'verifyBibliography'
  | 'findMissingReferences'
  | 'findUnusedReferences'
  | 'suggestBibliographyStyleAdjustments'
  | 'summarizeUsedReferences'
  | 'suggestCitationNeededPlaces'
  | 'transformDraftToAcademicArticle'
  | 'transformToProfessionalReport'
  | 'createShortAndLongVersions'
  | 'generatePresentationOutline'
  | 'createEditorialChecklist'
>

export class AiAssistantPanel {
  private result = ''
  private resultSource: 'selection' | 'document' = 'selection'
  private busy = false
  private error = ''
  private aiEnabled = false
  private keyConfigured = false
  private readonly resultDialog = new AiResultDialog()

  constructor(
    private readonly root: HTMLElement,
    private readonly editor: Editor,
    private readonly onSettings: () => void
  ) {
    this.editor.on('selectionUpdate', () => {
      if (!this.root.parentElement?.hasAttribute('hidden')) void this.refresh()
    })
    this.editor.on('update', () => {
      if (!this.root.parentElement?.hasAttribute('hidden')) void this.refresh()
    })
  }

  async refresh(): Promise<void> {
    const settings = await window.prosa.getSettings()
    this.aiEnabled = settings.aiEnabled
    this.keyConfigured = !!settings.aiApiKeyConfigured
    this.render()
  }

  private getSelectedText(): string {
    const { from, to, empty } = this.editor.state.selection
    if (empty) return ''
    return this.editor.state.doc.textBetween(from, to, '\n').trim()
  }

  private getDocumentText(): string {
    return this.editor.getText({ blockSeparator: '\n' }).trim()
  }

  private getDocumentOutlineText(): string {
    const headings: string[] = []
    const textOf = (node: TipTapJSON): string => {
      if (typeof node.text === 'string') return node.text
      return node.content?.map(textOf).join('') ?? ''
    }
    const walk = (node: TipTapJSON): void => {
      if (node.type === 'heading') {
        const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1
        const text = textOf(node).trim()
        if (text) headings.push(`${'  '.repeat(Math.max(0, level - 1))}- H${level}: ${text}`)
      }
      node.content?.forEach(walk)
    }
    walk(this.editor.getJSON() as TipTapJSON)
    return headings.length > 0 ? headings.join('\n') : 'Sem títulos estruturados no documento.'
  }

  private render(): void {
    const selected = this.getSelectedText()
    const documentText = this.getDocumentText()
    const ready = this.aiEnabled && this.keyConfigured
    const status = this.statusMessage(ready)
    const resultHtml = this.result
      ? `<p class="format-card-desc">Resposta gerada (${this.result.length} caracteres).</p>
        <div class="ai-actions-row">
          <button class="btn btn-secondary btn-sm" id="ai-view">Ver resposta</button>
          <button class="btn btn-secondary btn-sm" id="ai-copy">Copiar</button>
          <button class="btn btn-primary btn-sm" id="ai-apply" ${this.resultSource === 'selection' && !selected ? 'disabled' : ''}>
            ${this.resultSource === 'document' ? 'Inserir no cursor' : 'Substituir seleção'}
          </button>
        </div>`
      : '<p class="panel-empty">A resposta aparecerá em uma janela maior após ser gerada.</p>'

    this.root.innerHTML = `
      <div class="ai-panel">
        <div class="ai-panel-header">
          <div>
            <div class="panel-title">IA</div>
            <strong>Assistente de escrita</strong>
          </div>
          <button class="btn btn-ghost btn-sm" id="ai-settings" title="Configurações"><i class="ti ti-settings"></i></button>
        </div>
        <p class="format-card-desc">
          ${status.message}
        </p>
        ${ready ? '' : `<button id="ai-open-settings" class="btn btn-primary btn-sm">${status.actionLabel}</button>`}
        <div class="ai-selection">
          <span class="format-card-desc">${selected ? `${selected.length} caracteres selecionados` : 'Nenhum texto selecionado'}</span>
        </div>
        <div class="ai-document-card">
          <div>
            <strong>Documento inteiro</strong>
            <p class="format-card-desc">
              ${documentText ? `${documentText.length} caracteres. Envia o texto completo após confirmação.` : 'Documento vazio.'}
            </p>
          </div>
          <button id="ai-summarize-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Resumir documento</button>
          <button id="ai-abstract-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Gerar abstract</button>
          <button id="ai-intro-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Gerar introdução</button>
          <button id="ai-conclusion-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Gerar conclusão</button>
          <button id="ai-keywords-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Extrair palavras-chave</button>
          <button id="ai-titles-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Sugerir título e subtítulos</button>
          <button id="ai-main-points-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Listar pontos principais</button>
          <button id="ai-issues-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Analisar repetições e lacunas</button>
          <button id="ai-tone-review-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Revisar tom e estilo</button>
          ${documentText.length > MAX_AI_INPUT_CHARS ? `<p class="ai-error">Limite atual: ${MAX_AI_INPUT_CHARS} caracteres.</p>` : ''}
        </div>
        <div class="ai-field-group">
          <label class="format-card-desc" for="ai-document-tone">Padronizar documento para</label>
          <select id="ai-document-tone" class="field-select">
            <option value="formal">Formal</option>
            <option value="acadêmico">Acadêmico</option>
            <option value="técnico">Técnico</option>
          </select>
          <button id="ai-standardize-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Padronizar linguagem</button>
        </div>
        <div class="ai-document-card">
          <div>
            <strong>Revisão profunda</strong>
            <p class="format-card-desc">Analisa qualidade editorial, argumentação e consistência do documento.</p>
          </div>
          <button id="ai-weak-passages-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Apontar trechos vagos</button>
          <button id="ai-argument-expansion-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Sugerir expansão</button>
          <button id="ai-verb-person-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Verificar pessoa verbal</button>
        </div>
        <div class="ai-document-card">
          <div>
            <strong>Estrutura e outline</strong>
            <p class="format-card-desc">Sugere organização, outline ideal e divisão de seções.</p>
          </div>
          <button id="ai-structure-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Sugerir estrutura</button>
          <button id="ai-outline-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Comparar outline</button>
          <button id="ai-section-breakdown-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Dividir capítulos/seções</button>
          <button id="ai-long-sections-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Detectar seções longas</button>
          <button id="ai-transitions-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Sugerir transições</button>
          <button id="ai-reorganize-document" class="btn btn-secondary btn-sm" ${documentText && documentText.length <= MAX_AI_INPUT_CHARS ? '' : 'disabled'}>Reorganizar ideias</button>
        </div>
        <div class="ai-document-card">
          <div>
            <strong>Bibliografia</strong>
            <p class="format-card-desc">Cruza o texto com a biblioteca importada e aponta lacunas de citação.</p>
          </div>
          <button id="ai-bibliography-verify-document" class="btn btn-secondary btn-sm">Verificar citações</button>
          <button id="ai-bibliography-missing-document" class="btn btn-secondary btn-sm">Citações sem referência</button>
          <button id="ai-bibliography-unused-document" class="btn btn-secondary btn-sm">Referências não citadas</button>
          <button id="ai-bibliography-style-document" class="btn btn-secondary btn-sm">Ajustar estilo bibliográfico</button>
          <button id="ai-bibliography-used-document" class="btn btn-secondary btn-sm">Resumo das referências usadas</button>
          <button id="ai-bibliography-needed-document" class="btn btn-secondary btn-sm">Onde falta citação</button>
        </div>
        <div class="ai-document-card">
          <div>
            <strong>Formatos e entregáveis</strong>
            <p class="format-card-desc">Converte o conteúdo em formatos prontos para revisão, apresentação e exportação.</p>
          </div>
          <button id="ai-academic-article-document" class="btn btn-secondary btn-sm">Rascunho de artigo acadêmico</button>
          <button id="ai-report-document" class="btn btn-secondary btn-sm">Relatório profissional</button>
          <button id="ai-short-long-document" class="btn btn-secondary btn-sm">Versão curta e longa</button>
          <button id="ai-presentation-document" class="btn btn-secondary btn-sm">Estrutura de apresentação</button>
          <button id="ai-checklist-document" class="btn btn-secondary btn-sm">Checklist editorial</button>
        </div>
        <div class="ai-quick-grid">
          ${this.actionButton('review', 'Revisar', !!selected)}
          ${this.actionButton('improveClarity', 'Clareza', !!selected)}
          ${this.actionButton('summarize', 'Resumir', !!selected)}
          ${this.actionButton('expand', 'Expandir', !!selected)}
        </div>
        <div class="ai-field-group">
          <label class="format-card-desc" for="ai-target-language">Traduzir para</label>
          <select id="ai-target-language" class="field-select">
            ${AI_TRANSLATION_LANGUAGES.map((language) => `
              <option value="${escapeHtml(language.value)}" ${language.value === 'inglês' ? 'selected' : ''}>
                ${escapeHtml(language.label)}
              </option>
            `).join('')}
          </select>
          <button class="btn btn-secondary btn-sm ai-run" data-action="translate" ${selected ? '' : 'disabled'}>Traduzir</button>
        </div>
        <div class="ai-field-group">
          <label class="format-card-desc" for="ai-tone">Tom</label>
          <select id="ai-tone" class="field-select">
            ${AI_TONE_OPTIONS.map((tone) => `
              <option value="${escapeHtml(tone.value)}" ${tone.value === 'formal' ? 'selected' : ''}>
                ${escapeHtml(tone.label)}
              </option>
            `).join('')}
          </select>
          <button class="btn btn-secondary btn-sm ai-run" data-action="changeTone" ${selected ? '' : 'disabled'}>Mudar tom</button>
        </div>
        <div class="ai-field-group">
          <label class="format-card-desc" for="ai-custom">Instrução personalizada</label>
          <textarea id="ai-custom" class="ai-textarea" rows="4" placeholder="Ex.: deixe mais persuasivo"></textarea>
          <button class="btn btn-secondary btn-sm ai-run" data-action="custom" ${selected ? '' : 'disabled'}>Executar</button>
        </div>
        ${this.busy ? '<p class="format-card-desc">Gerando resposta...</p>' : ''}
        ${this.error ? `<p class="ai-error">${escapeHtml(this.error)}</p>` : ''}
        ${resultHtml}
      </div>
    `

    this.root.querySelector('#ai-settings')?.addEventListener('click', this.onSettings)
    this.root.querySelector('#ai-open-settings')?.addEventListener('click', this.onSettings)
    this.root.querySelectorAll<HTMLElement>('.ai-run').forEach((button) => {
      button.addEventListener('click', () => void this.run(button.dataset.action as AiWritingAction))
    })
    this.root.querySelector('#ai-summarize-document')?.addEventListener('click', () =>
      void this.runDocumentAction('summarize', 'Enviar o documento inteiro ao provedor de IA para gerar um resumo?')
    )
    this.root.querySelector('#ai-abstract-document')?.addEventListener('click', () =>
      void this.runDocumentAction('generateAbstract', 'Enviar o documento inteiro ao provedor de IA para gerar um abstract ou resumo executivo?')
    )
    this.root.querySelector('#ai-intro-document')?.addEventListener('click', () =>
      void this.runDocumentAction('generateIntroduction', 'Enviar o documento inteiro ao provedor de IA para gerar uma introdução?')
    )
    this.root.querySelector('#ai-conclusion-document')?.addEventListener('click', () =>
      void this.runDocumentAction('generateConclusion', 'Enviar o documento inteiro ao provedor de IA para gerar uma conclusão?')
    )
    this.root.querySelector('#ai-keywords-document')?.addEventListener('click', () =>
      void this.runDocumentAction('extractKeywords', 'Enviar o documento inteiro ao provedor de IA para extrair palavras-chave?')
    )
    this.root.querySelector('#ai-titles-document')?.addEventListener('click', () =>
      void this.runDocumentAction('suggestTitles', 'Enviar o documento inteiro ao provedor de IA para sugerir título e subtítulos?')
    )
    this.root.querySelector('#ai-main-points-document')?.addEventListener('click', () =>
      void this.runDocumentAction('mainPoints', 'Enviar o documento inteiro ao provedor de IA para listar os pontos principais?')
    )
    this.root.querySelector('#ai-issues-document')?.addEventListener('click', () =>
      void this.runDocumentAction('analyzeIssues', 'Enviar o documento inteiro ao provedor de IA para analisar repetições, lacunas e possíveis contradições?')
    )
    this.root.querySelector('#ai-tone-review-document')?.addEventListener('click', () =>
      void this.runDocumentAction('reviewToneConsistency', 'Enviar o documento inteiro ao provedor de IA para revisar tom e consistência de estilo?')
    )
    this.root.querySelector('#ai-standardize-document')?.addEventListener('click', () =>
      void this.runDocumentAction('standardizeLanguage', 'Enviar o documento inteiro ao provedor de IA para padronizar a linguagem?')
    )
    this.root.querySelector('#ai-weak-passages-document')?.addEventListener('click', () =>
      void this.runDocumentAction('flagWeakPassages', 'Enviar o documento inteiro ao provedor de IA para apontar trechos vagos ou fracos?')
    )
    this.root.querySelector('#ai-argument-expansion-document')?.addEventListener('click', () =>
      void this.runDocumentAction('suggestArgumentExpansion', 'Enviar o documento inteiro ao provedor de IA para sugerir expansão da argumentação?')
    )
    this.root.querySelector('#ai-verb-person-document')?.addEventListener('click', () =>
      void this.runDocumentAction('checkVerbPersonConsistency', 'Enviar o documento inteiro ao provedor de IA para verificar consistência de pessoa verbal?')
    )
    this.root.querySelector('#ai-structure-document')?.addEventListener('click', () =>
      void this.runDocumentAction('suggestStructure', 'Enviar o documento inteiro ao provedor de IA para sugerir uma estrutura melhor?')
    )
    this.root.querySelector('#ai-outline-document')?.addEventListener('click', () =>
      void this.runDocumentAction('compareOutline', 'Enviar o documento inteiro e o outline atual ao provedor de IA para comparar com um outline ideal?')
    )
    this.root.querySelector('#ai-section-breakdown-document')?.addEventListener('click', () =>
      void this.runDocumentAction('suggestSectionBreakdown', 'Enviar o documento inteiro ao provedor de IA para sugerir divisão de capítulos e seções?')
    )
    this.root.querySelector('#ai-long-sections-document')?.addEventListener('click', () =>
      void this.runDocumentAction('detectLongSections', 'Enviar o documento inteiro ao provedor de IA para detectar seções longas demais?')
    )
    this.root.querySelector('#ai-transitions-document')?.addEventListener('click', () =>
      void this.runDocumentAction('suggestTransitions', 'Enviar o documento inteiro ao provedor de IA para sugerir transições entre seções?')
    )
    this.root.querySelector('#ai-reorganize-document')?.addEventListener('click', () =>
      void this.runDocumentAction('reorganizeIdeas', 'Enviar o documento inteiro ao provedor de IA para reorganizar ideias em uma ordem mais lógica?')
    )
    this.root.querySelector('#ai-bibliography-verify-document')?.addEventListener('click', () =>
      void this.runDocumentAction('verifyBibliography', 'Enviar o documento e a bibliografia importada ao provedor de IA para verificar as citações e as entradas correspondentes?')
    )
    this.root.querySelector('#ai-bibliography-missing-document')?.addEventListener('click', () =>
      void this.runDocumentAction('findMissingReferences', 'Enviar o documento e a bibliografia importada ao provedor de IA para apontar citações sem referência?')
    )
    this.root.querySelector('#ai-bibliography-unused-document')?.addEventListener('click', () =>
      void this.runDocumentAction('findUnusedReferences', 'Enviar o documento e a bibliografia importada ao provedor de IA para apontar referências não citadas?')
    )
    this.root.querySelector('#ai-bibliography-style-document')?.addEventListener('click', () =>
      void this.runDocumentAction('suggestBibliographyStyleAdjustments', 'Enviar o documento e a bibliografia importada ao provedor de IA para sugerir ajustes no estilo bibliográfico?')
    )
    this.root.querySelector('#ai-bibliography-used-document')?.addEventListener('click', () =>
      void this.runDocumentAction('summarizeUsedReferences', 'Enviar o documento e a bibliografia importada ao provedor de IA para resumir as referências efetivamente usadas?')
    )
    this.root.querySelector('#ai-bibliography-needed-document')?.addEventListener('click', () =>
      void this.runDocumentAction('suggestCitationNeededPlaces', 'Enviar o documento inteiro ao provedor de IA para apontar trechos que parecem exigir citação?')
    )
    this.root.querySelector('#ai-academic-article-document')?.addEventListener('click', () =>
      void this.runDocumentAction('transformDraftToAcademicArticle', 'Enviar o documento inteiro ao provedor de IA para transformar o rascunho em artigo acadêmico revisável?')
    )
    this.root.querySelector('#ai-report-document')?.addEventListener('click', () =>
      void this.runDocumentAction('transformToProfessionalReport', 'Enviar o documento inteiro ao provedor de IA para transformar o texto em um relatório profissional?')
    )
    this.root.querySelector('#ai-short-long-document')?.addEventListener('click', () =>
      void this.runDocumentAction('createShortAndLongVersions', 'Enviar o documento inteiro ao provedor de IA para gerar uma versão curta e uma longa?')
    )
    this.root.querySelector('#ai-presentation-document')?.addEventListener('click', () =>
      void this.runDocumentAction('generatePresentationOutline', 'Enviar o documento inteiro ao provedor de IA para gerar uma estrutura de apresentação em slides?')
    )
    this.root.querySelector('#ai-checklist-document')?.addEventListener('click', () =>
      void this.runDocumentAction('createEditorialChecklist', 'Enviar o documento inteiro ao provedor de IA para gerar um checklist editorial antes da exportação?')
    )
    this.root.querySelector('#ai-view')?.addEventListener('click', () => this.openResultDialog())
    this.root.querySelector('#ai-copy')?.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.result)
    })
    this.root.querySelector('#ai-apply')?.addEventListener('click', () => {
      if (!this.result) return
      this.editor.chain().focus().insertContent(this.result).run()
    })
  }

  private openResultDialog(): void {
    if (!this.result) return
    const selected = this.getSelectedText()
    const canApply = this.resultSource === 'document' || !!selected
    this.resultDialog.show({
      title: 'Resposta da IA',
      text: this.result,
      applyLabel: this.resultSource === 'document' ? 'Inserir no cursor' : 'Substituir seleção',
      onApply: canApply ? () => this.editor.chain().focus().insertContent(this.result).run() : undefined
    })
  }

  private actionButton(action: AiWritingAction, label: string, enabled: boolean): string {
    return `<button class="btn btn-secondary btn-sm ai-run" data-action="${action}" ${enabled ? '' : 'disabled'}>${label}</button>`
  }

  private statusMessage(ready: boolean): { message: string; actionLabel: string } {
    if (ready) return { message: 'Usando apenas o texto selecionado.', actionLabel: 'Configurar IA' }
    if (!this.aiEnabled) {
      return {
        message: 'A IA ainda não está ativada. Abra as configurações, escolha o provedor e salve sua chave para usar o assistente.',
        actionLabel: 'Ativar IA'
      }
    }
    return {
      message: 'Falta configurar a chave de API do provedor escolhido antes de usar o assistente.',
      actionLabel: 'Configurar chave'
    }
  }

  private async ensureReady(): Promise<boolean> {
    const settings = await window.prosa.getSettings()
    this.aiEnabled = settings.aiEnabled
    this.keyConfigured = !!settings.aiApiKeyConfigured
    if (this.aiEnabled && this.keyConfigured) return true

    const message = !this.aiEnabled
      ? 'A IA ainda não está ativada. Para usar este recurso, abra as configurações de IA, escolha o provedor, informe sua chave de API e ative os recursos de IA.'
      : 'A IA está ativada, mas ainda falta configurar a chave de API do provedor escolhido.'
    const openSettings = await showConfirm(message, 'IA não configurada', 'warning', 'Abrir configurações', 'Agora não')
    if (openSettings) this.onSettings()
    await this.refresh()
    return false
  }

  private friendlyError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    if (/desativados/i.test(message)) {
      return 'A IA está desativada. Ative os recursos de IA nas configurações para continuar.'
    }
    if (/chave de API|api key/i.test(message)) {
      return 'Falta configurar a chave de API do provedor escolhido. Abra as configurações de IA e informe a chave.'
    }
    if (/Failed to fetch|fetch failed|network|ECONN|ENOTFOUND/i.test(message)) {
      return 'Não foi possível falar com o provedor de IA. Verifique sua conexão e tente novamente.'
    }
    if (/não retornou texto/i.test(message)) {
      return 'O provedor de IA respondeu, mas não retornou texto. Tente novamente ou escolha outro modelo.'
    }
    return message
  }

  private async run(action: AiWritingAction): Promise<void> {
    const text = this.getSelectedText()
    if (!text) {
      await showAlert('Selecione um trecho do documento antes de usar esta ação de IA.', 'Nenhum texto selecionado', 'warning')
      return
    }
    if (!await this.ensureReady()) return
    const instruction = this.root.querySelector<HTMLTextAreaElement>('#ai-custom')?.value
    const targetLanguage = this.root.querySelector<HTMLSelectElement>('#ai-target-language')?.value
    const tone = this.root.querySelector<HTMLSelectElement>('#ai-tone')?.value
    this.busy = true
    this.error = ''
    this.result = ''
    this.resultSource = 'selection'
    await this.refresh()

    try {
      const response = await window.prosa.runAiWritingAction({
        action,
        text,
        instruction,
        targetLanguage,
        tone
      })
      this.result = response.text
      this.openResultDialog()
    } catch (error) {
      this.error = this.friendlyError(error)
    } finally {
      this.busy = false
      await this.refresh()
    }
  }

  private async runDocumentAction(action: DocumentAiAction, confirmation: string): Promise<void> {
    const documentText = this.getDocumentText()
    if (!documentText) {
      await showAlert('O documento está vazio. Escreva ou abra um documento antes de usar esta ação de IA.', 'Documento vazio', 'warning')
      return
    }
    const citations = extractCitations(this.editor.getJSON() as TipTapJSON)
    const library = await window.prosa.getWorkspaceLibrary()
    const bibliography = library.bibliography
    const text = this.buildDocumentActionText(action, documentText, citations, bibliography)
    if (!await this.ensureReady()) return
    if (text.length > MAX_AI_INPUT_CHARS) {
      this.error = `O conteúdo enviado teria ${text.length} caracteres. O limite atual é ${MAX_AI_INPUT_CHARS}.`
      await this.refresh()
      return
    }
    const confirmed = await showConfirm(
      confirmation,
      this.confirmationTitle(action),
      'warning',
      'Enviar'
    )
    if (!confirmed) return

    this.busy = true
    this.error = ''
    this.result = ''
    this.resultSource = 'document'
    await this.refresh()

    try {
      const response = await window.prosa.runAiWritingAction({
        action,
        text,
        tone: action === 'suggestBibliographyStyleAdjustments'
          ? bibliography.style
          : this.root.querySelector<HTMLSelectElement>('#ai-document-tone')?.value
      })
      this.result = response.text
      this.openResultDialog()
    } catch (error) {
      this.error = this.friendlyError(error)
    } finally {
      this.busy = false
      await this.refresh()
    }
  }

  private buildDocumentActionText(
    action: DocumentAiAction,
    text: string,
    citations: string[],
    bibliography: WorkspaceLibraryData['bibliography']
  ): string {
    if (action === 'compareOutline') {
      return `Outline atual:\n${this.getDocumentOutlineText()}\n\nDocumento:\n${text}`
    }

    if (action === 'verifyBibliography' || action === 'findMissingReferences' || action === 'findUnusedReferences' || action === 'suggestBibliographyStyleAdjustments' || action === 'summarizeUsedReferences') {
      const bibliographyEntries = bibliography.entries
        .map((entry, index) => this.formatBibliographyContextEntry(entry, index + 1))
        .join('\n')
      const matchedEntries = bibliography.entries.filter((entry) => citations.includes(entry.key))
      const missingCitations = citations.filter((citeKey) => !bibliography.entries.some((entry) => entry.key === citeKey))
      const unusedEntries = bibliography.entries.filter((entry) => !citations.includes(entry.key))

      return [
        `Estilo bibliográfico atual: ${bibliography.style}`,
        `Citações no documento: ${citations.length > 0 ? citations.join(', ') : 'nenhuma'}`,
        `Entradas na bibliografia: ${bibliography.entries.length}`,
        bibliographyEntries ? `Bibliografia importada:\n${bibliographyEntries}` : 'Bibliografia importada: nenhuma entrada.',
        `Citações com entrada correspondente: ${matchedEntries.length > 0 ? matchedEntries.map((entry) => entry.key).join(', ') : 'nenhuma'}`,
        `Citações sem referência: ${missingCitations.length > 0 ? missingCitations.join(', ') : 'nenhuma'}`,
        `Referências não citadas: ${unusedEntries.length > 0 ? unusedEntries.map((entry) => entry.key).join(', ') : 'nenhuma'}`
      ].join('\n\n')
    }

    if (action === 'suggestCitationNeededPlaces') {
      return [
        `Citações já presentes no documento: ${citations.length > 0 ? citations.join(', ') : 'nenhuma'}`,
        'Documento:',
        text
      ].join('\n\n')
    }

    return text
  }

  private formatBibliographyContextEntry(entry: BibliographyEntry, index: number): string {
    const source = entry.journal || entry.booktitle || entry.publisher || entry.institution || entry.school || 'fonte não informada'
    const details = [entry.author || 'autor não informado', entry.year || 's.d.', source].join(' · ')
    return `${index}. ${entry.key} — ${details} — ${entry.title}`
  }

  private confirmationTitle(action: DocumentAiAction): string {
    if (action === 'suggestStructure' || action === 'compareOutline' || action === 'suggestSectionBreakdown' || action === 'detectLongSections' || action === 'suggestTransitions' || action === 'reorganizeIdeas') {
      return 'Análise de estrutura'
    }
    if (action === 'suggestCitationNeededPlaces') {
      return 'Analisar documento'
    }
    if (action === 'verifyBibliography' || action === 'findMissingReferences' || action === 'findUnusedReferences' || action === 'suggestBibliographyStyleAdjustments' || action === 'summarizeUsedReferences') {
      return 'Análise bibliográfica'
    }
    if (action === 'transformDraftToAcademicArticle' || action === 'transformToProfessionalReport' || action === 'createShortAndLongVersions' || action === 'generatePresentationOutline' || action === 'createEditorialChecklist') {
      return 'Formatos de saída'
    }
    return 'Enviar documento inteiro'
  }
}
