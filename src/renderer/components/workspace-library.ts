// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { formatBibliographyEntry } from '../../shared/bibliography.js'
import type {
  BibliographyStyle,
  RecentFile,
  WorkspaceDocumentSummary,
  WorkspaceLibraryData,
  WorkspaceRelations
} from '../../shared/types.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface WorkspaceLibraryCallbacks {
  onOpenDocument: (path: string) => void
  onCreateAbnt: () => void
  onInsertBibliography: (style: BibliographyStyle, keys: string[]) => void
}

export class WorkspaceLibraryDialog {
  private readonly overlay: HTMLElement
  private resolve: (() => void) | null = null
  private data: WorkspaceLibraryData | null = null
  private selectedPath: string | null = null
  private relations: WorkspaceRelations | null = null

  constructor(private readonly callbacks: WorkspaceLibraryCallbacks, parent: HTMLElement = document.body) {
    this.overlay = document.createElement('div')
    this.overlay.className = 'modal-overlay'
    this.overlay.hidden = true
    parent.appendChild(this.overlay)
  }

  async show(): Promise<void> {
    this.data = await window.prosa.getWorkspaceLibrary()
    this.selectedPath = this.data.documents[0]?.path ?? null
    this.relations = this.selectedPath ? await window.prosa.getWorkspaceRelations(this.selectedPath) : null
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

  private get selectedDocument(): WorkspaceDocumentSummary | null {
    return this.data?.documents.find((doc) => doc.path === this.selectedPath) ?? null
  }

  private async selectDocument(path: string): Promise<void> {
    this.selectedPath = path
    this.relations = await window.prosa.getWorkspaceRelations(path)
    this.render()
  }

  private async importBibTeX(file: File): Promise<void> {
    const content = await file.text()
    await window.prosa.importBibTeX(content)
    this.data = await window.prosa.getWorkspaceLibrary()
    this.relations = this.selectedPath ? await window.prosa.getWorkspaceRelations(this.selectedPath) : null
    this.render()
  }

  private async setStyle(style: BibliographyStyle): Promise<void> {
    await window.prosa.setBibliographyStyle(style)
    this.data = await window.prosa.getWorkspaceLibrary()
    this.render()
  }

  private render(): void {
    const data = this.data
    const selected = this.selectedDocument
    const docs = this.filteredDocuments()
    const recent = this.filteredQuickAccess(data?.recentFiles ?? [])
    const pinned = this.filteredQuickAccess(data?.pinnedFiles ?? [])
    const bibliography = data?.bibliography ?? { style: 'ABNT', entries: [], importedAt: null }
    const style = bibliography.style
    const previousSearch = this.overlay.querySelector<HTMLInputElement>('#workspace-search')?.value ?? ''
    const previousFilter = this.overlay.querySelector<HTMLSelectElement>('#workspace-filter')?.value ?? 'all'
    const previousDate = this.overlay.querySelector<HTMLInputElement>('#workspace-date')?.value ?? ''
    const bibliographyPreview = bibliography.entries
      .slice(0, 8)
      .map((entry, index) => `<li>${escapeHtml(formatBibliographyEntry(entry, style, index + 1))}</li>`)
      .join('')
    const status =
      data?.error
        ? `<div class="panel-empty">Biblioteca indisponível: ${escapeHtml(data.error)}</div>`
        : data?.root
          ? `<div class="panel-empty">Workspace: ${escapeHtml(data.root)}</div>`
          : '<div class="panel-empty">Nenhuma pasta de workspace configurada.</div>'

    this.overlay.innerHTML = `
      <div class="modal modal-wide workspace-library" role="dialog" aria-label="Biblioteca do workspace">
        <div class="modal-header">
          <h2>Biblioteca do workspace</h2>
          <button class="modal-close" title="Fechar"><i class="ti ti-x"></i></button>
        </div>
        <div class="workspace-library-toolbar">
          <input id="workspace-search" class="palette-input" type="text" placeholder="Buscar por nome, tag, coleção ou tipo" />
          <select id="workspace-filter" class="palette-input">
            <option value="all">Tudo</option>
            <option value="prosa">Prosa</option>
            <option value="md">Markdown</option>
            <option value="txt">Texto</option>
            <option value="docx">DOCX</option>
            <option value="odt">ODT</option>
            <option value="rtf">RTF</option>
            <option value="doc">DOC</option>
          </select>
          <input id="workspace-date" class="palette-input" type="date" aria-label="Filtrar por data" />
          <button class="btn btn-primary" id="workspace-abnt"><i class="ti ti-school"></i> Novo ABNT</button>
        </div>
        <div class="workspace-library-body">
          <section class="workspace-library-list">
            <div class="panel-title">Documentos ${data ? `(${data.documents.length})` : ''}</div>
            ${status}
            <div class="workspace-section">
              <div class="workspace-subtitle">Fixados</div>
              ${pinned.length > 0
                ? `<div class="workspace-quick-list">${pinned.map((item) => this.renderQuickAccessItem(item, true)).join('')}</div>`
                : '<div class="panel-empty">Nenhum fixado.</div>'}
            </div>
            <div class="workspace-section">
              <div class="workspace-subtitle">Recentes</div>
              ${recent.length > 0
                ? `<div class="workspace-quick-list">${recent.map((item) => this.renderQuickAccessItem(item, false)).join('')}</div>`
                : '<div class="panel-empty">Nenhum recente.</div>'}
            </div>
            <div class="workspace-section">
              <div class="workspace-subtitle">Arquivos do workspace</div>
              ${docs.length > 0
                ? `<div class="workspace-doc-list">${docs.map((doc) => this.renderDocumentCard(doc, doc.path === selected?.path)).join('')}</div>`
                : '<div class="panel-empty">Nenhum documento encontrado.</div>'}
            </div>
          </section>
          <section class="workspace-library-details">
            ${selected ? this.renderDetails(selected, this.relations, bibliographyPreview, style) : '<div class="panel-empty">Selecione um documento.</div>'}
          </section>
        </div>
      </div>
    `

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => this.hide())
    this.overlay.querySelector('#workspace-abnt')?.addEventListener('click', () => this.callbacks.onCreateAbnt())
    const search = this.overlay.querySelector<HTMLInputElement>('#workspace-search')
    const filter = this.overlay.querySelector<HTMLSelectElement>('#workspace-filter')
    if (search) {
      search.value = previousSearch
      search.addEventListener('input', () => this.render())
    }
    if (filter) {
      filter.value = previousFilter
      filter.addEventListener('change', () => this.render())
    }
    const date = this.overlay.querySelector<HTMLInputElement>('#workspace-date')
    if (date) {
      date.value = previousDate
      date.addEventListener('change', () => this.render())
    }

    this.overlay.querySelectorAll<HTMLElement>('[data-open-path]').forEach((item) => {
      item.addEventListener('click', () => {
        const path = item.dataset.openPath
        if (path) {
          void this.callbacks.onOpenDocument(path)
          this.hide()
        }
      })
    })

    this.overlay.querySelectorAll<HTMLElement>('[data-select-path]').forEach((item) => {
      item.addEventListener('click', () => {
        const path = item.dataset.selectPath
        if (path) void this.selectDocument(path)
      })
    })

    this.overlay.querySelector('#bibliography-style')?.addEventListener('change', (event) => {
      const value = (event.target as HTMLSelectElement).value as BibliographyStyle
      void this.setStyle(value)
    })

    this.overlay.querySelector('#bibtex-input')?.addEventListener('change', async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (file) await this.importBibTeX(file)
    })

    this.overlay.querySelector('#bibtex-file-trigger')?.addEventListener('click', () => {
      this.overlay.querySelector<HTMLInputElement>('#bibtex-input')?.click()
    })

    this.overlay.querySelector('#bibtex-paste')?.addEventListener('click', async () => {
      const text = prompt('Cole o conteúdo BibTeX:')
      if (text) {
        await window.prosa.importBibTeX(text)
        this.data = await window.prosa.getWorkspaceLibrary()
        this.render()
      }
    })

    this.overlay.querySelector('#bibliography-insert')?.addEventListener('click', () => {
      const keys = selected?.citations ?? []
      this.callbacks.onInsertBibliography(style, keys)
      this.hide()
    })
  }

  private filteredDocuments(): WorkspaceDocumentSummary[] {
    const data = this.data
    if (!data) return []
    const search = this.overlay.querySelector<HTMLInputElement>('#workspace-search')?.value.trim().toLowerCase() ?? ''
    const filter = this.overlay.querySelector<HTMLSelectElement>('#workspace-filter')?.value ?? 'all'
    const date = this.overlay.querySelector<HTMLInputElement>('#workspace-date')?.value ?? ''
    return data.documents.filter((doc) => {
      const text = [doc.name, doc.title, doc.path, ...doc.tags, ...doc.collections, ...doc.citations].join(' ').toLowerCase()
      const typeMatches = filter === 'all' || doc.format === filter
      const dateMatches = !date || doc.modifiedAt.startsWith(date)
      return typeMatches && dateMatches && (!search || text.includes(search))
    })
  }

  private filteredQuickAccess(files: RecentFile[]): RecentFile[] {
    const search = this.overlay.querySelector<HTMLInputElement>('#workspace-search')?.value.trim().toLowerCase() ?? ''
    const date = this.overlay.querySelector<HTMLInputElement>('#workspace-date')?.value ?? ''
    return files.filter((file) => {
      const text = [file.name, file.path].join(' ').toLowerCase()
      const dateMatches = !date || file.modifiedAt.startsWith(date)
      return dateMatches && (!search || text.includes(search))
    })
  }

  private renderDocumentCard(doc: WorkspaceDocumentSummary, active: boolean): string {
    const chips = [...doc.tags, ...doc.collections].slice(0, 4).map((item) => `<span class="library-chip">${escapeHtml(item)}</span>`).join('')
    return `
      <button class="workspace-doc-card ${active ? 'active' : ''}" data-select-path="${escapeHtml(doc.path)}">
        <div class="workspace-doc-card-title">${escapeHtml(doc.title)}</div>
        <div class="workspace-doc-card-meta">${escapeHtml(doc.name)} · ${escapeHtml(doc.format.toUpperCase())}</div>
        <div class="workspace-doc-card-snippet">${escapeHtml(doc.excerpt || doc.path)}</div>
        <div class="workspace-doc-chip-row">${chips}</div>
      </button>
    `
  }

  private renderQuickAccessItem(file: RecentFile, pinned: boolean): string {
    return `
      <button class="workspace-mini-link" data-open-path="${escapeHtml(file.path)}">
        <span>${escapeHtml(file.name)}</span>
        <span class="library-chip">${pinned ? 'Fixado' : 'Recente'}</span>
      </button>
    `
  }

  private renderDetails(
    doc: WorkspaceDocumentSummary,
    relations: WorkspaceRelations | null,
    bibliographyPreview: string,
    style: BibliographyStyle
  ): string {
    const backlinks = relations?.backlinks ?? []
    const related = relations?.related ?? []
    const brokenLinks = relations?.brokenLinks ?? []
    return `
      <div class="workspace-details-head">
        <div>
          <div class="panel-title">${escapeHtml(doc.title)}</div>
          <div class="panel-empty">${escapeHtml(doc.path)}</div>
        </div>
        <button class="btn btn-secondary" data-open-path="${escapeHtml(doc.path)}"><i class="ti ti-edit"></i> Abrir</button>
      </div>
      <div class="workspace-section">
        <div class="panel-title">Tags e coleções</div>
        <div class="workspace-chip-grid">
          ${(doc.tags.length > 0 ? doc.tags : ['Sem tags']).map((item) => `<span class="library-chip">${escapeHtml(item)}</span>`).join('')}
          ${(doc.collections.length > 0 ? doc.collections : ['Sem coleções']).map((item) => `<span class="library-chip">${escapeHtml(item)}</span>`).join('')}
        </div>
        <p class="panel-empty">Edite esses metadados no painel de frontmatter do documento aberto.</p>
      </div>
      <div class="workspace-section">
        <div class="panel-title">Relações</div>
        <div class="workspace-subtitle">Backlinks</div>
        ${backlinks.length > 0 ? backlinks.map((item) => `<button class="workspace-mini-link" data-open-path="${escapeHtml(item.path)}">${escapeHtml(item.title)}</button>`).join('') : '<div class="panel-empty">Nenhum backlink encontrado.</div>'}
        <div class="workspace-subtitle">Relacionados</div>
        ${related.length > 0 ? related.map((item) => `<button class="workspace-mini-link" data-open-path="${escapeHtml(item.path)}">${escapeHtml(item.title)}</button>`).join('') : '<div class="panel-empty">Sem relações fortes encontradas.</div>'}
        <div class="workspace-subtitle">Links quebrados</div>
        ${brokenLinks.length > 0 ? brokenLinks.map((item) => `<div class="workspace-broken-link">${escapeHtml(item)}</div>`).join('') : '<div class="panel-empty">Nenhum link quebrado.</div>'}
      </div>
      <div class="workspace-section">
        <div class="panel-title">Bibliografia</div>
        <div class="workspace-bib-toolbar">
          <select id="bibliography-style" class="palette-input">
            <option value="ABNT" ${style === 'ABNT' ? 'selected' : ''}>ABNT</option>
            <option value="APA" ${style === 'APA' ? 'selected' : ''}>APA</option>
            <option value="IEEE" ${style === 'IEEE' ? 'selected' : ''}>IEEE</option>
          </select>
          <input id="bibtex-input" type="file" accept=".bib,.txt" hidden />
          <button class="btn btn-secondary" id="bibtex-file-trigger"><i class="ti ti-file-type-bib"></i> Arquivo BibTeX</button>
          <button class="btn btn-secondary" id="bibtex-paste"><i class="ti ti-clipboard-text"></i> Importar BibTeX</button>
          <button class="btn btn-primary" id="bibliography-insert"><i class="ti ti-book"></i> Inserir no documento</button>
        </div>
        <ul class="workspace-bibliography-list">
          ${bibliographyPreview || '<li class="panel-empty">Nenhuma entrada importada.</li>'}
        </ul>
      </div>
    `
  }
}
