// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import mammoth from 'mammoth'
import { marked } from 'marked'
import {
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  Paragraph,
  Table as DocxTable,
  TableCell as DocxTableCell,
  TableRow as DocxTableRow,
  TextRun,
  WidthType
} from 'docx'
import { parseHeaderHtml } from './html-runs.js'
import { indexNotes } from '../shared/document-utils.js'
import type { NoteEntry, TipTapJSON } from '../shared/types.js'

/** Opções de cabeçalho/rodapé (HTML) para as exportações. */
export interface HeaderFooterOptions {
  header?: string
  footer?: string
}

/* -------------------------------------------------------------------------- */
/* Importação                                                                 */
/* -------------------------------------------------------------------------- */

/** Converte um arquivo .docx (buffer) em HTML para alimentar o editor. */
export async function importDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer })
  return result.value
}

/** Substitui blocos $$...$$ por um placeholder HTML reconhecido pelo nó mathBlock. */
function preprocessMathBlocks(markdown: string): string {
  return markdown.replace(/\$\$\n([\s\S]*?)\n\$\$/g, (_match, latex: string) => {
    return `<div data-math-block data-latex="${encodeURIComponent(latex)}"></div>`
  })
}

/** Converte Markdown em HTML para alimentar o editor. */
export function importMarkdown(markdown: string): string {
  return marked.parse(preprocessMathBlocks(markdown), { async: false }) as string
}

/** Converte texto puro em HTML, preservando parágrafos. */
export function importPlainText(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const paragraphs = escaped.split(/\n{2,}/)
  return paragraphs
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

/* -------------------------------------------------------------------------- */
/* Exportação — Markdown                                                       */
/* -------------------------------------------------------------------------- */

/** Aplica as marcas (negrito, itálico, código, link) ao texto em Markdown. */
function applyMarkdownMarks(text: string, node: TipTapJSON, noteNumbers?: Map<string, number>): string {
  let result = text
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        result = `**${result}**`
        break
      case 'italic':
        result = `*${result}*`
        break
      case 'strike':
        result = `~~${result}~~`
        break
      case 'code':
        result = `\`${result}\``
        break
      case 'link': {
        const href = String(mark.attrs?.href ?? '')
        result = `[${result}](${href})`
        break
      }
      case 'noteReference': {
        const noteId = String(mark.attrs?.noteId ?? '')
        const number = noteNumbers?.get(noteId)
        result = number ? `[${number}]` : result
        break
      }
      default:
        break
    }
  }
  return result
}

/** Converte os filhos inline de um nó em uma string Markdown. */
function inlineToMarkdown(node: TipTapJSON, noteNumbers?: Map<string, number>): string {
  if (node.type === 'text') {
    return applyMarkdownMarks(node.text ?? '', node, noteNumbers)
  }
  if (node.type === 'hardBreak') {
    return '  \n'
  }
  if (node.type === 'image') {
    const alt = String(node.attrs?.alt ?? '')
    const src = String(node.attrs?.src ?? '')
    return `![${alt}](${src})`
  }
  if (node.type === 'noteReference') {
    const number = noteNumbers?.get(String(node.attrs?.noteId ?? ''))
    return number ? `[${number}]` : ''
  }
  return (node.content ?? []).map((child) => inlineToMarkdown(child, noteNumbers)).join('')
}

/** Converte um nó de lista (bullet/ordered) em Markdown. */
function listToMarkdown(node: TipTapJSON, ordered: boolean, depth: number, noteNumbers?: Map<string, number>): string {
  const indent = '  '.repeat(depth)
  const lines: string[] = []
  let counter = 1
  for (const item of node.content ?? []) {
    const marker = ordered ? `${counter}.` : '-'
    const inner = (item.content ?? [])
      .map((child) => blockToMarkdown(child, depth + 1, noteNumbers).trimEnd())
      .filter((s) => s.length > 0)
    const first = inner.shift() ?? ''
    lines.push(`${indent}${marker} ${first}`)
    for (const extra of inner) {
      lines.push(`${indent}  ${extra}`)
    }
    counter += 1
  }
  return lines.join('\n') + '\n'
}

/** Converte um nó de bloco TipTap em Markdown. */
function blockToMarkdown(node: TipTapJSON, depth = 0, noteNumbers?: Map<string, number>): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((n) => blockToMarkdown(n, depth, noteNumbers)).join('\n')
    case 'paragraph': {
      const text = inlineToMarkdown(node, noteNumbers)
      return text.length > 0 ? `${text}\n` : '\n'
    }
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return `${'#'.repeat(level)} ${inlineToMarkdown(node, noteNumbers)}\n`
    }
    case 'blockquote':
      return (node.content ?? [])
        .map((n) => `> ${blockToMarkdown(n, depth, noteNumbers).trimEnd()}`)
        .join('\n') + '\n'
    case 'codeBlock': {
      const lang = String(node.attrs?.language ?? '')
      return `\`\`\`${lang}\n${inlineToMarkdown(node, noteNumbers)}\n\`\`\`\n`
    }
    case 'bulletList':
      return listToMarkdown(node, false, depth, noteNumbers)
    case 'orderedList':
      return listToMarkdown(node, true, depth, noteNumbers)
    case 'taskList':
      return (node.content ?? [])
        .map((item) => {
          const checked = item.attrs?.checked ? 'x' : ' '
          const text = (item.content ?? []).map((c) => inlineToMarkdown(c, noteNumbers)).join('')
          return `- [${checked}] ${text}`
        })
        .join('\n') + '\n'
    case 'horizontalRule':
      return '---\n'
    case 'image':
      return inlineToMarkdown(node, noteNumbers) + '\n'
    case 'table':
      return tableToMarkdown(node, noteNumbers)
    case 'mathBlock':
      return `$$\n${String(node.attrs?.latex ?? '')}\n$$\n`
    default:
      return inlineToMarkdown(node, noteNumbers)
  }
}

/** Converte uma tabela TipTap em Markdown (GFM). */
function tableToMarkdown(node: TipTapJSON, noteNumbers?: Map<string, number>): string {
  const rows = node.content ?? []
  if (rows.length === 0) return ''
  const cellsOf = (row: TipTapJSON): string[] =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? []).map((c) => inlineToMarkdown(c, noteNumbers)).join(' ').trim()
    )
  const header = cellsOf(rows[0])
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`]
  for (const row of rows.slice(1)) {
    lines.push(`| ${cellsOf(row).join(' | ')} |`)
  }
  return lines.join('\n') + '\n'
}

function notesMarkdown(doc: TipTapJSON, notes: Record<string, NoteEntry>): string {
  const { footnotes, endnotes } = indexNotes(doc, notes)
  const sections: string[] = []
  if (footnotes.length > 0) {
    sections.push('## Notas de rodapé')
    for (const note of footnotes) {
      sections.push(`[${note.number}] ${note.text}`)
    }
  }
  if (endnotes.length > 0) {
    sections.push('## Notas finais')
    for (const note of endnotes) {
      sections.push(`[${note.number}] ${note.text}`)
    }
  }
  return sections.length > 0 ? `\n\n${sections.join('\n')}\n` : ''
}

/** Converte o documento TipTap completo em uma string Markdown. */
export function exportMarkdown(doc: TipTapJSON, notes: Record<string, NoteEntry> = {}): string {
  return blockToMarkdown(doc, 0, indexNotes(doc, notes).numbers).replace(/\n{3,}/g, '\n\n').trim() + notesMarkdown(doc, notes)
}

/* -------------------------------------------------------------------------- */
/* Exportação — DOCX                                                          */
/* -------------------------------------------------------------------------- */

/** Mapeia o nível de heading do TipTap para o enum do pacote docx. */
const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6
}

/** Converte os nós inline de um parágrafo em TextRuns do docx. */
function inlineToRuns(node: TipTapJSON, noteNumbers?: Map<string, number>): TextRun[] {
  const runs: TextRun[] = []

  function visit(child: TipTapJSON): void {
    if (child.type === 'text') {
      const marks = child.marks ?? []
      const has = (type: string): boolean => marks.some((m) => m.type === type)
      runs.push(
        new TextRun({
          text: child.text ?? '',
          bold: has('bold'),
          italics: has('italic'),
          underline: has('underline') ? {} : undefined,
          strike: has('strike'),
          subScript: has('subscript'),
          superScript: has('superscript')
        })
      )
    } else if (child.type === 'noteReference') {
      const number = noteNumbers?.get(String(child.attrs?.noteId ?? ''))
      if (number) {
        runs.push(new TextRun({ text: `[${number}]`, superScript: true }))
      }
    } else if (child.type === 'hardBreak') {
      runs.push(new TextRun({ text: '', break: 1 }))
    } else {
      ;(child.content ?? []).forEach(visit)
    }
  }

  ;(node.content ?? []).forEach(visit)
  if (runs.length === 0) {
    runs.push(new TextRun({ text: '' }))
  }
  return runs
}

/** Converte um nó de bloco em um ou mais elementos do docx. */
function blockToDocx(node: TipTapJSON, noteNumbers?: Map<string, number>): (Paragraph | DocxTable)[] {
  switch (node.type) {
    case 'paragraph':
      return [new Paragraph({ children: inlineToRuns(node, noteNumbers) })]
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return [
        new Paragraph({
          heading: headingMap[level] ?? HeadingLevel.HEADING_1,
          children: inlineToRuns(node, noteNumbers)
        })
      ]
    }
    case 'blockquote':
      return (node.content ?? []).flatMap((child) =>
        blockToDocx(child, noteNumbers).map((p) =>
          p instanceof Paragraph
            ? new Paragraph({ children: inlineToRuns(child, noteNumbers), indent: { left: 720 } })
            : p
        )
      )
    case 'codeBlock':
      return [
        new Paragraph({
          children: [new TextRun({ text: extractPlain(node), font: 'Courier New' })]
        })
      ]
    case 'bulletList':
    case 'orderedList':
      return (node.content ?? []).flatMap((item, idx) =>
        (item.content ?? []).map(
          (child) =>
            new Paragraph({
              children: inlineToRuns(child, noteNumbers),
              bullet: node.type === 'bulletList' ? { level: 0 } : undefined,
              numbering:
                node.type === 'orderedList'
                  ? { reference: 'prosa-ordered', level: 0, instance: idx }
                  : undefined
            })
        )
      )
    case 'table':
      return [tableToDocx(node, noteNumbers)]
    case 'mathBlock':
      return [
        new Paragraph({
          alignment: 'center',
          children: [new TextRun({ text: String(node.attrs?.latex ?? ''), font: 'Courier New' })]
        })
      ]
    default:
      return [new Paragraph({ children: inlineToRuns(node, noteNumbers) })]
  }
}

/** Extrai o texto puro de um nó (usado em blocos de código). */
function extractPlain(node: TipTapJSON): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(extractPlain).join('')
}

/** Converte uma tabela TipTap em uma Table do docx. */
function tableToDocx(node: TipTapJSON, noteNumbers?: Map<string, number>): DocxTable {
  const rows = (node.content ?? []).map(
    (row) =>
      new DocxTableRow({
        children: (row.content ?? []).map(
          (cell) =>
            new DocxTableCell({
              children: (cell.content ?? []).flatMap((child) =>
                blockToDocx(child, noteNumbers).filter((b): b is Paragraph => b instanceof Paragraph)
              )
            })
        )
      })
  )
  return new DocxTable({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE }
  })
}

/** Converte o HTML de uma banda em parágrafos do docx (ou null se vazia). */
function bandToDocxParagraphs(html?: string): Paragraph[] | null {
  const lines = parseHeaderHtml(html ?? '')
  if (lines.length === 0) return null
  return lines.map(
    (line) =>
      new Paragraph({
        children: line.runs.map(
          (run) =>
            new TextRun({
              text: run.text,
              bold: run.bold,
              italics: run.italic,
              underline: run.underline ? {} : undefined
            })
        )
      })
  )
}

/** Converte o documento TipTap completo em um buffer .docx. */
export async function exportDocx(
  doc: TipTapJSON,
  options: HeaderFooterOptions = {},
  notes: Record<string, NoteEntry> = {}
): Promise<Buffer> {
  const { footnotes, endnotes, numbers } = indexNotes(doc, notes)
  const children = (doc.content ?? []).flatMap((node) => blockToDocx(node, numbers))
  const headerParagraphs = bandToDocxParagraphs(options.header)
  const footerParagraphs = bandToDocxParagraphs(options.footer)
  const noteSections: Paragraph[] = []
  if (footnotes.length > 0) {
    noteSections.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: 'Notas de rodapé' })]
      })
    )
    for (const note of footnotes) {
      noteSections.push(new Paragraph({ children: [new TextRun({ text: `[${note.number}] ${note.text}` })] }))
    }
  }
  if (endnotes.length > 0) {
    noteSections.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: 'Notas finais' })]
      })
    )
    for (const note of endnotes) {
      noteSections.push(new Paragraph({ children: [new TextRun({ text: `[${note.number}] ${note.text}` })] }))
    }
  }

  const document = new Document({
    creator: 'Prosa — Rodrigo Brito',
    sections: [
      {
        headers: headerParagraphs
          ? { default: new Header({ children: headerParagraphs }) }
          : undefined,
        footers: footerParagraphs
          ? { default: new Footer({ children: footerParagraphs }) }
          : undefined,
        children: children.length > 0 ? [...children, ...noteSections] : [new Paragraph({}), ...noteSections]
      }
    ]
  })
  return Packer.toBuffer(document)
}
