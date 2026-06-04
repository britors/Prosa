// Prosa — Editor de Texto
// Copyright (C) 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
// SPDX-License-Identifier: GPL-3.0-or-later

import mammoth from 'mammoth'
import { marked } from 'marked'
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table as DocxTable,
  TableCell as DocxTableCell,
  TableRow as DocxTableRow,
  TextRun,
  WidthType
} from 'docx'
import type { TipTapJSON } from '../shared/types.js'

/* -------------------------------------------------------------------------- */
/* Importação                                                                 */
/* -------------------------------------------------------------------------- */

/** Converte um arquivo .docx (buffer) em HTML para alimentar o editor. */
export async function importDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer })
  return result.value
}

/** Converte Markdown em HTML para alimentar o editor. */
export function importMarkdown(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string
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
function applyMarkdownMarks(text: string, node: TipTapJSON): string {
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
      default:
        break
    }
  }
  return result
}

/** Converte os filhos inline de um nó em uma string Markdown. */
function inlineToMarkdown(node: TipTapJSON): string {
  if (node.type === 'text') {
    return applyMarkdownMarks(node.text ?? '', node)
  }
  if (node.type === 'hardBreak') {
    return '  \n'
  }
  if (node.type === 'image') {
    const alt = String(node.attrs?.alt ?? '')
    const src = String(node.attrs?.src ?? '')
    return `![${alt}](${src})`
  }
  return (node.content ?? []).map(inlineToMarkdown).join('')
}

/** Converte um nó de lista (bullet/ordered) em Markdown. */
function listToMarkdown(node: TipTapJSON, ordered: boolean, depth: number): string {
  const indent = '  '.repeat(depth)
  const lines: string[] = []
  let counter = 1
  for (const item of node.content ?? []) {
    const marker = ordered ? `${counter}.` : '-'
    const inner = (item.content ?? [])
      .map((child) => blockToMarkdown(child, depth + 1).trimEnd())
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
function blockToMarkdown(node: TipTapJSON, depth = 0): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((n) => blockToMarkdown(n, depth)).join('\n')
    case 'paragraph': {
      const text = inlineToMarkdown(node)
      return text.length > 0 ? `${text}\n` : '\n'
    }
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return `${'#'.repeat(level)} ${inlineToMarkdown(node)}\n`
    }
    case 'blockquote':
      return (node.content ?? [])
        .map((n) => `> ${blockToMarkdown(n, depth).trimEnd()}`)
        .join('\n') + '\n'
    case 'codeBlock': {
      const lang = String(node.attrs?.language ?? '')
      return `\`\`\`${lang}\n${inlineToMarkdown(node)}\n\`\`\`\n`
    }
    case 'bulletList':
      return listToMarkdown(node, false, depth)
    case 'orderedList':
      return listToMarkdown(node, true, depth)
    case 'taskList':
      return (node.content ?? [])
        .map((item) => {
          const checked = item.attrs?.checked ? 'x' : ' '
          const text = (item.content ?? []).map((c) => inlineToMarkdown(c)).join('')
          return `- [${checked}] ${text}`
        })
        .join('\n') + '\n'
    case 'horizontalRule':
      return '---\n'
    case 'image':
      return inlineToMarkdown(node) + '\n'
    case 'table':
      return tableToMarkdown(node)
    default:
      return inlineToMarkdown(node)
  }
}

/** Converte uma tabela TipTap em Markdown (GFM). */
function tableToMarkdown(node: TipTapJSON): string {
  const rows = node.content ?? []
  if (rows.length === 0) return ''
  const cellsOf = (row: TipTapJSON): string[] =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? []).map((c) => inlineToMarkdown(c)).join(' ').trim()
    )
  const header = cellsOf(rows[0])
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`]
  for (const row of rows.slice(1)) {
    lines.push(`| ${cellsOf(row).join(' | ')} |`)
  }
  return lines.join('\n') + '\n'
}

/** Converte o documento TipTap completo em uma string Markdown. */
export function exportMarkdown(doc: TipTapJSON): string {
  return blockToMarkdown(doc).replace(/\n{3,}/g, '\n\n').trim() + '\n'
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
function inlineToRuns(node: TipTapJSON): TextRun[] {
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
function blockToDocx(node: TipTapJSON): (Paragraph | DocxTable)[] {
  switch (node.type) {
    case 'paragraph':
      return [new Paragraph({ children: inlineToRuns(node) })]
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return [
        new Paragraph({
          heading: headingMap[level] ?? HeadingLevel.HEADING_1,
          children: inlineToRuns(node)
        })
      ]
    }
    case 'blockquote':
      return (node.content ?? []).flatMap((child) =>
        blockToDocx(child).map((p) =>
          p instanceof Paragraph
            ? new Paragraph({ children: inlineToRuns(child), indent: { left: 720 } })
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
              children: inlineToRuns(child),
              bullet: node.type === 'bulletList' ? { level: 0 } : undefined,
              numbering:
                node.type === 'orderedList'
                  ? { reference: 'prosa-ordered', level: 0, instance: idx }
                  : undefined
            })
        )
      )
    case 'table':
      return [tableToDocx(node)]
    default:
      return [new Paragraph({ children: inlineToRuns(node) })]
  }
}

/** Extrai o texto puro de um nó (usado em blocos de código). */
function extractPlain(node: TipTapJSON): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(extractPlain).join('')
}

/** Converte uma tabela TipTap em uma Table do docx. */
function tableToDocx(node: TipTapJSON): DocxTable {
  const rows = (node.content ?? []).map(
    (row) =>
      new DocxTableRow({
        children: (row.content ?? []).map(
          (cell) =>
            new DocxTableCell({
              children: (cell.content ?? []).flatMap((child) =>
                blockToDocx(child).filter((b): b is Paragraph => b instanceof Paragraph)
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

/** Converte o documento TipTap completo em um buffer .docx. */
export async function exportDocx(doc: TipTapJSON): Promise<Buffer> {
  const children = (doc.content ?? []).flatMap(blockToDocx)
  const document = new Document({
    creator: 'Prosa — W3TI',
    sections: [{ children: children.length > 0 ? children : [new Paragraph({})] }]
  })
  return Packer.toBuffer(document)
}
