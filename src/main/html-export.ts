// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import katex from 'katex'
import { indexNotes } from '../shared/document-utils.js'
import type { HtmlExportOptions, NoteEntry, TipTapJSON } from '../shared/types.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function renderLatex(latex: string): string {
  try {
    return katex.renderToString(latex || '\\text{(fórmula vazia)}', {
      throwOnError: false,
      displayMode: true
    })
  } catch {
    return `<span class="math-error">${escapeHtml(latex || 'fórmula inválida')}</span>`
  }
}

function renderInline(node: TipTapJSON, noteNumbers?: Map<string, number>): string {
  if (node.type === 'text') {
    return renderMarks(escapeHtml(node.text ?? ''), node, noteNumbers)
  }
  if (node.type === 'hardBreak') return '<br />'
  if (node.type === 'noteReference') {
    const number = noteNumbers?.get(String(node.attrs?.noteId ?? ''))
    return number ? `<sup class="note-reference">${number}</sup>` : ''
  }
  if (node.type === 'image') {
    const src = escapeHtml(String(node.attrs?.src ?? ''))
    const alt = escapeHtml(String(node.attrs?.alt ?? ''))
    const title = String(node.attrs?.title ?? '').trim()
    const width = String(node.attrs?.width ?? '').trim()
    const height = String(node.attrs?.height ?? '').trim()
    const attrs = [
      `src="${src}"`,
      `alt="${alt}"`,
      title ? `title="${escapeHtml(title)}"` : '',
      width ? `width="${escapeHtml(width)}"` : '',
      height ? `height="${escapeHtml(height)}"` : ''
    ].filter(Boolean).join(' ')
    return `<img ${attrs} />`
  }
  return (node.content ?? []).map((child) => renderInline(child, noteNumbers)).join('')
}

function renderMarks(content: string, node: TipTapJSON, noteNumbers?: Map<string, number>): string {
  let result = content
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        result = `<strong>${result}</strong>`
        break
      case 'italic':
        result = `<em>${result}</em>`
        break
      case 'strike':
        result = `<s>${result}</s>`
        break
      case 'underline':
        result = `<u>${result}</u>`
        break
      case 'code':
        result = `<code>${result}</code>`
        break
      case 'link': {
        const href = String(mark.attrs?.href ?? '')
        const hrefAttr = href.startsWith('prosa://wiki/')
          ? `#${slugify(decodeURIComponent(href.slice('prosa://wiki/'.length)))}`
          : href
        result = `<a href="${escapeHtml(hrefAttr)}">${result}</a>`
        break
      }
      case 'highlight':
        result = `<mark>${result}</mark>`
        break
      case 'subscript':
        result = `<sub>${result}</sub>`
        break
      case 'superscript':
        result = `<sup>${result}</sup>`
        break
      case 'tag': {
        const tagName = String(mark.attrs?.tagName ?? '').trim()
        result = `<span class="tag" data-tag="${escapeHtml(tagName)}">${result}</span>`
        break
      }
      case 'citation': {
        const citeKey = String(mark.attrs?.citeKey ?? '').trim()
        result = `<cite data-cite-key="${escapeHtml(citeKey)}">${result}</cite>`
        break
      }
      case 'wikilink': {
        const href = String(mark.attrs?.href ?? '')
        const target = href.startsWith('prosa://wiki/')
          ? decodeURIComponent(href.slice('prosa://wiki/'.length))
          : href
        result = `<a class="wikilink" data-wikilink="${escapeHtml(target)}" href="#${escapeHtml(slugify(target))}">${result}</a>`
        break
      }
      case 'noteReference': {
        const number = noteNumbers?.get(String(mark.attrs?.noteId ?? ''))
        result = number ? `<sup class="note-reference">${number}</sup>` : result
        break
      }
      case 'textStyle': {
        const styles: string[] = []
        if (typeof mark.attrs?.color === 'string' && mark.attrs.color) {
          styles.push(`color: ${mark.attrs.color}`)
        }
        if (typeof mark.attrs?.fontFamily === 'string' && mark.attrs.fontFamily) {
          styles.push(`font-family: ${mark.attrs.fontFamily}`)
        }
        if (typeof mark.attrs?.fontSize === 'string' && mark.attrs.fontSize) {
          styles.push(`font-size: ${mark.attrs.fontSize}`)
        }
        if (styles.length > 0) {
          result = `<span style="${escapeHtml(styles.join('; '))}">${result}</span>`
        }
        break
      }
      default:
        break
    }
  }
  return result
}

function renderList(node: TipTapJSON, ordered: boolean, noteNumbers?: Map<string, number>): string {
  const tag = ordered ? 'ol' : 'ul'
  const items = (node.content ?? []).map((item) => {
    const checked = item.attrs?.checked
    const children = (item.content ?? []).map((child) => renderBlock(child, noteNumbers)).join('')
    const attrs = typeof checked === 'boolean' ? ` data-checked="${checked}"` : ''
    return `<li${attrs}>${children}</li>`
  }).join('')
  return `<${tag}>${items}</${tag}>`
}

function renderTable(node: TipTapJSON, noteNumbers?: Map<string, number>): string {
  const rows = node.content ?? []
  if (rows.length === 0) return ''
  const renderCell = (cell: TipTapJSON, tag: 'th' | 'td'): string => {
    const attrs = [
      cell.attrs?.colspan ? `colspan="${escapeHtml(String(cell.attrs.colspan))}"` : '',
      cell.attrs?.rowspan ? `rowspan="${escapeHtml(String(cell.attrs.rowspan))}"` : ''
    ].filter(Boolean).join(' ')
    const children = (cell.content ?? []).map((child) => renderBlock(child, noteNumbers)).join('')
    return `<${tag}${attrs ? ` ${attrs}` : ''}>${children}</${tag}>`
  }
  const headerRow = rows[0]
  const bodyRows = rows.slice(1)
  return [
    '<table>',
    '<thead>',
    `<tr>${(headerRow.content ?? []).map((cell) => renderCell(cell, 'th')).join('')}</tr>`,
    '</thead>',
    bodyRows.length > 0 ? '<tbody>' : '',
    ...bodyRows.map((row) => `<tr>${(row.content ?? []).map((cell) => renderCell(cell, 'td')).join('')}</tr>`),
    bodyRows.length > 0 ? '</tbody>' : '',
    '</table>'
  ].join('')
}

function renderBlock(node: TipTapJSON, noteNumbers?: Map<string, number>): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((child) => renderBlock(child, noteNumbers)).join('')
    case 'paragraph':
      return `<p>${renderInline(node, noteNumbers)}</p>`
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)))
      const id = slugify(renderPlainText(node))
      return `<h${level}${id ? ` id="${escapeHtml(id)}"` : ''}>${renderInline(node, noteNumbers)}</h${level}>`
    }
    case 'blockquote':
      return `<blockquote>${(node.content ?? []).map((child) => renderBlock(child, noteNumbers)).join('')}</blockquote>`
    case 'codeBlock': {
      const lang = String(node.attrs?.language ?? '').trim()
      return `<pre><code${lang ? ` data-language="${escapeHtml(lang)}"` : ''}>${escapeHtml(renderPlainText(node))}</code></pre>`
    }
    case 'bulletList':
      return renderList(node, false, noteNumbers)
    case 'orderedList':
      return renderList(node, true, noteNumbers)
    case 'taskList':
      return `<ul class="task-list">${(node.content ?? []).map((item) => {
        const checked = item.attrs?.checked ? ' checked' : ''
        const content = (item.content ?? []).map((child) => renderBlock(child, noteNumbers)).join('')
        return `<li><input type="checkbox" disabled${checked} />${content}</li>`
      }).join('')}</ul>`
    case 'horizontalRule':
      return '<hr />'
    case 'image':
      return `<figure>${renderInline(node, noteNumbers)}${node.attrs?.alt ? `<figcaption>${escapeHtml(String(node.attrs.alt))}</figcaption>` : ''}</figure>`
    case 'table':
      return renderTable(node, noteNumbers)
    case 'mathBlock':
      return `<div class="math-block" data-latex="${escapeHtml(String(node.attrs?.latex ?? ''))}">${renderLatex(String(node.attrs?.latex ?? ''))}</div>`
    default:
      return renderInline(node, noteNumbers)
  }
}

function renderPlainText(node: TipTapJSON): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(renderPlainText).join('')
}

function buildMinimalStyles(): string {
  return `
    :root { color-scheme: light; }
    body { margin: 0; font-family: Georgia, 'Times New Roman', serif; line-height: 1.7; color: #111827; background: #ffffff; }
    main { max-width: 76ch; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.7em; }
    p, ul, ol, blockquote, pre, table, figure { margin: 0 0 1rem; }
    img { max-width: 100%; height: auto; }
    blockquote { border-left: 4px solid #d1d5db; padding-left: 1rem; color: #4b5563; }
    pre { overflow: auto; padding: 1rem; background: #f3f4f6; border-radius: 8px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #d1d5db; padding: 0.5rem 0.75rem; vertical-align: top; }
    th { background: #f9fafb; }
    figure { margin: 1rem 0; }
    figcaption { color: #6b7280; font-size: 0.95rem; margin-top: 0.35rem; }
    .math-block { margin: 1rem 0; overflow-x: auto; }
    .wikilink { color: #0369a1; text-decoration: underline; }
    .tag, cite { background: #f3f4f6; border-radius: 999px; padding: 0 0.45rem; }
    .task-list { list-style: none; padding-left: 0; }
    .task-list li { display: flex; gap: 0.6rem; align-items: flex-start; }
    .note-reference { vertical-align: super; font-size: 0.78em; line-height: 0; color: #0f766e; }
    .notes { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; }
    .notes h2 { font-size: 1.15rem; margin: 0 0 0.75rem; }
    .notes ol { margin: 0; padding-left: 1.25rem; }
  `
}

/** Converte o documento TipTap em HTML limpo para publicação. */
function notesSection(doc: TipTapJSON, notes: Record<string, NoteEntry>): string {
  const { footnotes, endnotes } = indexNotes(doc, notes)
  const sections: string[] = []
  if (footnotes.length > 0) {
    sections.push('<section class="notes"><h2>Notas de rodapé</h2><ol>' + footnotes.map((note) => `<li id="note-${escapeHtml(note.id)}">[${note.number}] ${escapeHtml(note.text)}</li>`).join('') + '</ol></section>')
  }
  if (endnotes.length > 0) {
    sections.push('<section class="notes"><h2>Notas finais</h2><ol>' + endnotes.map((note) => `<li id="note-${escapeHtml(note.id)}">[${note.number}] ${escapeHtml(note.text)}</li>`).join('') + '</ol></section>')
  }
  return sections.join('\n')
}

export function exportHtml(doc: TipTapJSON, options: HtmlExportOptions, notes: Record<string, NoteEntry> = {}): string {
  const { numbers } = indexNotes(doc, notes)
  const content = (doc.content ?? []).map((node) => renderBlock(node, numbers)).join('\n')
  const notesHtml = notesSection(doc, notes)
  if (options.mode === 'content') {
    return [content, notesHtml].filter(Boolean).join('\n')
  }

  const title = options.title?.trim() || 'Documento'
  const styles = options.includeStyles ? `<style>${buildMinimalStyles()}</style>` : ''
  return [
    '<!doctype html>',
    '<html lang="pt-BR">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(title)}</title>`,
    styles,
    '</head>',
    '<body>',
    '<main class="prosa-export">',
    content,
    '</main>',
    notesHtml,
    '</body>',
    '</html>'
  ].join('')
}
