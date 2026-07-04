// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { indexNotes } from '../shared/document-utils.js'
import type { NoteEntry, SavePayload, TipTapJSON } from '../shared/types.js'

/** Tipo MIME obrigatório do arquivo EPUB. */
const EPUB_MIME = 'application/epub+zip'

/** Namespace XHTML usado nos documentos internos do EPUB. */
const XHTML_NS = 'http://www.w3.org/1999/xhtml'

/** Namespace EPUB OPS usado no documento de navegação. */
const EPUB_OPS_NS = 'http://www.idpf.org/2007/ops'

/** Namespace OPF usado no package.opf. */
const OPF_NS = 'http://www.idpf.org/2007/opf'

/** Namespace Dublin Core usado no package.opf. */
const DC_NS = 'http://purl.org/dc/elements/1.1/'

interface RenderContext {
  noteNumbers: Map<string, number>
  headings: { id: string; level: number; text: string }[]
  images: EpubImageAsset[]
  headingCount: number
  imageCount: number
}

interface EpubImageAsset {
  id: string
  fileName: string
  mediaType: string
  data: Buffer
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapeHtml(value: string): string {
  return escapeXml(value)
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function textContent(node: TipTapJSON): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(textContent).join('')
}

function normalizeLanguage(value: unknown): string {
  if (typeof value !== 'string') return 'pt-BR'
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : 'pt-BR'
}

function buildDescription(payload: SavePayload): string {
  const frontmatterDescription = payload.frontmatter?.description?.trim()
  if (frontmatterDescription) return frontmatterDescription
  const plain = payload.text.trim().replace(/\s+/g, ' ')
  return plain.slice(0, 240)
}

function parseDataUrl(src: string): { mediaType: string; data: Buffer } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(src)
  if (!match) {
    throw new Error(
      'O EPUB só preserva imagens embutidas como data URL. ' +
        'Reinsira a imagem no documento para exportá-la.'
    )
  }
  const mediaType = (match[1] || 'image/png').toLowerCase()
  const isBase64 = Boolean(match[2])
  const payload = match[3] ?? ''
  const data = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf-8')
  return { mediaType, data }
}

function extensionForMediaType(mediaType: string): string {
  switch (mediaType) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/svg+xml':
      return 'svg'
    default:
      return 'png'
  }
}

function ensureUniqueSlug(base: string, existing: Set<string>): string {
  const root = base.trim() || 'section'
  let slug = root
  let suffix = 2
  while (existing.has(slug)) {
    slug = `${root}-${suffix}`
    suffix += 1
  }
  existing.add(slug)
  return slug
}

function renderInline(node: TipTapJSON, ctx: RenderContext): string {
  if (node.type === 'text') {
    return renderMarks(escapeXml(node.text ?? ''), node, ctx)
  }
  if (node.type === 'hardBreak') return '<br />'
  if (node.type === 'noteReference') {
    const number = ctx.noteNumbers.get(String(node.attrs?.noteId ?? ''))
    return number ? `<sup class="note-reference">${number}</sup>` : ''
  }
  if (node.type === 'image') {
    const src = String(node.attrs?.src ?? '').trim()
    if (!src) {
      throw new Error('A imagem do documento está sem fonte (src).')
    }
    const { mediaType, data } = parseDataUrl(src)
    const ext = extensionForMediaType(mediaType)
    const assetId = `img-${ctx.imageCount + 1}`
    ctx.imageCount += 1
    const fileName = `${assetId}.${ext}`
    ctx.images.push({ id: assetId, fileName, mediaType, data })
    const alt = escapeXml(String(node.attrs?.alt ?? ''))
    const title = String(node.attrs?.title ?? '').trim()
    const width = String(node.attrs?.width ?? '').trim()
    const height = String(node.attrs?.height ?? '').trim()
    const attrs = [
      `src="../images/${escapeXml(fileName)}"`,
      `alt="${alt}"`,
      title ? `title="${escapeXml(title)}"` : '',
      width ? `width="${escapeXml(width)}"` : '',
      height ? `height="${escapeXml(height)}"` : ''
    ].filter(Boolean).join(' ')
    return `<img ${attrs} />`
  }
  return (node.content ?? []).map((child) => renderInline(child, ctx)).join('')
}

function renderMarks(content: string, node: TipTapJSON, ctx: RenderContext): string {
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
        const href = String(mark.attrs?.href ?? '').trim()
        if (href) result = `<a href="${escapeXml(href)}">${result}</a>`
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
      case 'citation': {
        const citeKey = String(mark.attrs?.citeKey ?? '').trim()
        result = citeKey ? `<cite data-cite-key="${escapeXml(citeKey)}">${result}</cite>` : result
        break
      }
      case 'tag': {
        const tagName = String(mark.attrs?.tagName ?? '').trim()
        result = tagName ? `<span class="tag" data-tag="${escapeXml(tagName)}">${result}</span>` : result
        break
      }
      case 'wikilink': {
        const href = String(mark.attrs?.href ?? '').trim()
        if (href) result = `<a class="wikilink" href="${escapeXml(href)}">${result}</a>`
        break
      }
      case 'noteReference': {
        const number = ctx.noteNumbers.get(String(mark.attrs?.noteId ?? ''))
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
          result = `<span style="${escapeXml(styles.join('; '))}">${result}</span>`
        }
        break
      }
      default:
        break
    }
  }
  return result
}

function renderList(node: TipTapJSON, ordered: boolean, ctx: RenderContext): string {
  const tag = ordered ? 'ol' : 'ul'
  const items = (node.content ?? [])
    .map((item) => {
      const checked = typeof item.attrs?.checked === 'boolean' ? item.attrs.checked : undefined
      const children = (item.content ?? []).map((child) => renderBlock(child, ctx)).join('')
      const attrs = typeof checked === 'boolean' ? ` data-checked="${checked}"` : ''
      return `<li${attrs}>${children}</li>`
    })
    .join('')
  return `<${tag}>${items}</${tag}>`
}

function renderTable(node: TipTapJSON, ctx: RenderContext): string {
  const rows = node.content ?? []
  if (rows.length === 0) return ''
  const renderCell = (cell: TipTapJSON, tag: 'th' | 'td'): string => {
    const attrs = [
      cell.attrs?.colspan ? `colspan="${escapeXml(String(cell.attrs.colspan))}"` : '',
      cell.attrs?.rowspan ? `rowspan="${escapeXml(String(cell.attrs.rowspan))}"` : ''
    ].filter(Boolean).join(' ')
    const children = (cell.content ?? []).map((child) => renderBlock(child, ctx)).join('')
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

function renderBlock(node: TipTapJSON, ctx: RenderContext): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((child) => renderBlock(child, ctx)).join('')
    case 'paragraph':
      return `<p>${renderInline(node, ctx)}</p>`
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)))
      const text = textContent(node).trim()
      const id = ensureUniqueSlug(slugify(text) || `heading-${ctx.headingCount + 1}`, new Set(ctx.headings.map((item) => item.id)))
      ctx.headingCount += 1
      if (text) ctx.headings.push({ id, level, text })
      return `<h${level} id="${escapeXml(id)}">${renderInline(node, ctx)}</h${level}>`
    }
    case 'blockquote':
      return `<blockquote>${(node.content ?? []).map((child) => renderBlock(child, ctx)).join('')}</blockquote>`
    case 'codeBlock': {
      const lang = String(node.attrs?.language ?? '').trim()
      const attrs = lang ? ` data-language="${escapeXml(lang)}"` : ''
      return `<pre><code${attrs}>${escapeXml(textContent(node))}</code></pre>`
    }
    case 'bulletList':
      return renderList(node, false, ctx)
    case 'orderedList':
      return renderList(node, true, ctx)
    case 'taskList':
      return `<ul class="task-list">${(node.content ?? [])
        .map((item) => {
          const checked = item.attrs?.checked ? ' checked' : ''
          const content = (item.content ?? []).map((child) => renderBlock(child, ctx)).join('')
          return `<li><input type="checkbox" disabled${checked} />${content}</li>`
        })
        .join('')}</ul>`
    case 'horizontalRule':
      return '<hr />'
    case 'pageBreak':
      return '<div class="page-break" role="doc-pagebreak" aria-label="Quebra de página"></div>'
    case 'image':
      return `<figure>${renderInline(node, ctx)}${node.attrs?.alt ? `<figcaption>${escapeHtml(String(node.attrs.alt))}</figcaption>` : ''}</figure>`
    case 'table':
      return renderTable(node, ctx)
    case 'mathBlock':
      return `<pre class="math-block"><code>${escapeXml(String(node.attrs?.latex ?? ''))}</code></pre>`
    default:
      return renderInline(node, ctx)
  }
}

function collectNotes(doc: TipTapJSON, notes: Record<string, NoteEntry>): { footnotes: string; endnotes: string; numbers: Map<string, number> } {
  const { footnotes, endnotes, numbers } = indexNotes(doc, notes)
  const footnotesHtml = footnotes.length > 0
    ? `<section class="notes"><h2>Notas de rodapé</h2><ol>${footnotes
        .map((note) => `<li id="note-${escapeXml(note.id)}">[${note.number}] ${escapeXml(note.text)}</li>`)
        .join('')}</ol></section>`
    : ''
  const endnotesHtml = endnotes.length > 0
    ? `<section class="notes"><h2>Notas finais</h2><ol>${endnotes
        .map((note) => `<li id="note-${escapeXml(note.id)}">[${note.number}] ${escapeXml(note.text)}</li>`)
        .join('')}</ol></section>`
    : ''
  return { footnotes: footnotesHtml, endnotes: endnotesHtml, numbers }
}

function buildStylesheet(): string {
  return `
    body { margin: 0; font-family: serif; line-height: 1.7; color: #111; }
    main { max-width: 100%; padding: 0; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.7em; }
    p, ul, ol, blockquote, pre, table, figure { margin: 0 0 1em; }
    img { max-width: 100%; height: auto; }
    figure { margin: 1em 0; }
    figcaption { font-size: 0.95em; color: #555; margin-top: 0.35em; }
    blockquote { border-left: 4px solid #d1d5db; padding-left: 1em; color: #4b5563; }
    pre { overflow-wrap: anywhere; white-space: pre-wrap; }
    code { font-family: monospace; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #d1d5db; padding: 0.4em 0.6em; vertical-align: top; }
    th { background: #f8fafc; }
    .page-break { break-after: page; page-break-after: always; height: 0; margin: 0; border: 0; }
    .task-list { list-style: none; padding-left: 0; }
    .task-list li { display: flex; gap: 0.5em; align-items: flex-start; }
    .note-reference { vertical-align: super; font-size: 0.8em; line-height: 0; }
    .notes { margin-top: 2em; padding-top: 1em; border-top: 1px solid #ddd; }
    .notes h2 { font-size: 1.1em; margin: 0 0 0.75em; }
    .notes ol { margin: 0; padding-left: 1.25em; }
    .math-block { background: #f8fafc; padding: 0.75em; border-radius: 0.25em; }
    .wikilink { text-decoration: underline; }
    .tag, cite { background: #f3f4f6; border-radius: 999px; padding: 0 0.45em; }
  `
}

function buildChapter(payload: SavePayload): { xhtml: string; images: EpubImageAsset[]; headings: { id: string; level: number; text: string }[] } {
  const notes = payload.notes ?? {}
  const { footnotes, endnotes, numbers } = collectNotes(payload.json, notes)
  const ctx: RenderContext = {
    noteNumbers: numbers,
    headings: [],
    images: [],
    headingCount: 0,
    imageCount: 0
  }
  const body = (payload.json.content ?? []).map((node) => renderBlock(node, ctx)).join('\n')
  const title = escapeXml(payload.metadata.title || 'Documento')
  const notesHtml = [footnotes, endnotes].filter(Boolean).join('\n')
  const xhtml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE html>',
    `<html xmlns="${XHTML_NS}" lang="${escapeXml(normalizeLanguage(payload.frontmatter?.language))}">`,
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${title}</title>`,
    '<link rel="stylesheet" type="text/css" href="../styles/styles.css" />',
    '</head>',
    '<body>',
    '<main>',
    body,
    notesHtml,
    '</main>',
    '</body>',
    '</html>'
  ].join('')
  return { xhtml, images: ctx.images, headings: ctx.headings }
}

function buildNav(payload: SavePayload, headings: { id: string; level: number; text: string }[]): string {
  const title = escapeXml(payload.metadata.title || 'Documento')
  const tocItems = headings.length > 0
    ? headings.map((heading) => {
        const indent = '  '.repeat(Math.max(0, heading.level - 1))
        return `${indent}<li><a href="text/chapter.xhtml#${escapeXml(heading.id)}">${escapeXml(heading.text)}</a></li>`
      }).join('\n')
    : `<li><a href="text/chapter.xhtml">${title}</a></li>`
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE html>',
    `<html xmlns="${XHTML_NS}" xmlns:epub="${EPUB_OPS_NS}" lang="${escapeXml(normalizeLanguage(payload.frontmatter?.language))}">`,
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${title}</title>`,
    '</head>',
    '<body>',
    '<nav epub:type="toc" id="toc">',
    `<h1>${title}</h1>`,
    '<ol>',
    tocItems,
    '</ol>',
    '</nav>',
    '</body>',
    '</html>'
  ].join('')
}

function buildOpf(
  payload: SavePayload,
  images: EpubImageAsset[],
  modifiedAt: string
): string {
  const title = escapeXml(payload.metadata.title || payload.frontmatter?.title || 'Documento')
  const author = escapeXml(
    (payload.metadata.author || payload.frontmatter?.author || payload.frontmatter?.authorName || '').trim() || 'Desconhecido'
  )
  const language = escapeXml(normalizeLanguage(payload.frontmatter?.language))
  const description = escapeXml(buildDescription(payload))
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="chapter" href="text/chapter.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="css" href="styles/styles.css" media-type="text/css"/>',
    ...images.map((image) => `<item id="${escapeXml(image.id)}" href="images/${escapeXml(image.fileName)}" media-type="${escapeXml(image.mediaType)}"/>`)
  ].join('')
  const spine = '<itemref idref="chapter"/>'
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<package xmlns="${OPF_NS}" unique-identifier="bookid" version="3.0" xml:lang="${language}" prefix="dc: ${DC_NS}">`,
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `<dc:identifier id="bookid">${escapeXml(`urn:uuid:${randomUUID()}`)}</dc:identifier>`,
    `<dc:title>${title}</dc:title>`,
    `<dc:creator>${author}</dc:creator>`,
    `<dc:language>${language}</dc:language>`,
    description ? `<dc:description>${description}</dc:description>` : '',
    `<meta property="dcterms:modified">${escapeXml(modifiedAt)}</meta>`,
    '</metadata>',
    `<manifest>${manifest}</manifest>`,
    `<spine>${spine}</spine>`,
    '</package>'
  ].join('')
}

function buildContainer(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    '<rootfiles>',
    '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>',
    '</rootfiles>',
    '</container>'
  ].join('')
}

/** Gera um buffer EPUB válido a partir do payload do documento. */
export async function exportEpub(payload: SavePayload): Promise<Buffer> {
  const zip = new JSZip()
  const modifiedAt = payload.metadata.modifiedAt || new Date().toISOString()
  const { xhtml, images, headings } = buildChapter(payload)
  const nav = buildNav(payload, headings)
  const opf = buildOpf(payload, images, modifiedAt)

  zip.file('mimetype', EPUB_MIME, { compression: 'STORE' })
  zip.folder('META-INF')?.file('container.xml', buildContainer())
  const oebps = zip.folder('OEBPS')
  oebps?.file('content.opf', opf)
  oebps?.file('nav.xhtml', nav)
  oebps?.folder('text')?.file('chapter.xhtml', xhtml)
  oebps?.folder('styles')?.file('styles.css', buildStylesheet())
  const imagesFolder = oebps?.folder('images')
  for (const image of images) {
    imagesFolder?.file(image.fileName, image.data)
  }

  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
