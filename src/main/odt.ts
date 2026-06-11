// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { parseHeaderHtml } from './html-runs.js'
import type { TipTapJSON } from '../shared/types.js'

/** Tipo MIME do OpenDocument Text. */
const ODT_MIME = 'application/vnd.oasis.opendocument.text'

/** Conjunto de marcas de formatação inline reconhecidas. */
interface RunMarks {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                  */
/* -------------------------------------------------------------------------- */

/** Escapa texto para uso seguro em XML. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Escapa texto para uso seguro em HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/* -------------------------------------------------------------------------- */
/* Exportação — TipTap JSON → .odt                                            */
/* -------------------------------------------------------------------------- */

/**
 * Registra estilos de texto automáticos sob demanda, deduplicando combinações
 * de marcas (negrito, itálico, etc.) em nomes de estilo reutilizáveis.
 */
class TextStyleRegistry {
  private readonly map = new Map<string, string>()

  /** Devolve (criando se preciso) o nome do estilo para as marcas dadas. */
  nameFor(marks: RunMarks): string | null {
    if (!marks.bold && !marks.italic && !marks.underline && !marks.strike) {
      return null
    }
    const key = `${marks.bold}-${marks.italic}-${marks.underline}-${marks.strike}`
    let name = this.map.get(key)
    if (!name) {
      name = `T${this.map.size + 1}`
      this.map.set(key, name)
    }
    return name
  }

  /** Gera o XML <style:style> de todos os estilos de texto registrados. */
  toXml(): string {
    const parts: string[] = []
    for (const [key, name] of this.map.entries()) {
      const [bold, italic, underline, strike] = key.split('-').map((v) => v === 'true')
      const props: string[] = []
      if (bold) props.push('fo:font-weight="bold" style:font-weight-asian="bold"')
      if (italic) props.push('fo:font-style="italic" style:font-style-asian="italic"')
      if (underline) {
        props.push(
          'style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"'
        )
      }
      if (strike) props.push('style:text-line-through-style="solid"')
      parts.push(
        `<style:style style:name="${name}" style:family="text">` +
          `<style:text-properties ${props.join(' ')}/></style:style>`
      )
    }
    return parts.join('')
  }
}

/** Extrai as marcas de formatação de um nó de texto TipTap. */
function readMarks(node: TipTapJSON): RunMarks {
  const has = (type: string): boolean => (node.marks ?? []).some((m) => m.type === type)
  return {
    bold: has('bold'),
    italic: has('italic'),
    underline: has('underline'),
    strike: has('strike')
  }
}

/** Converte os nós inline de um bloco em XML ODT (text:span / text:a). */
function inlineToOdt(node: TipTapJSON, styles: TextStyleRegistry): string {
  const out: string[] = []

  const visit = (child: TipTapJSON): void => {
    if (child.type === 'text') {
      const text = escapeXml(child.text ?? '')
      const link = (child.marks ?? []).find((m) => m.type === 'link')
      const styleName = styles.nameFor(readMarks(child))
      let piece = styleName ? `<text:span text:style-name="${styleName}">${text}</text:span>` : text
      if (link) {
        const href = escapeXml(String(link.attrs?.href ?? ''))
        piece = `<text:a xlink:href="${href}">${piece}</text:a>`
      }
      out.push(piece)
    } else if (child.type === 'hardBreak') {
      out.push('<text:line-break/>')
    } else {
      ;(child.content ?? []).forEach(visit)
    }
  }

  ;(node.content ?? []).forEach(visit)
  return out.join('')
}

/** Converte um nó de lista em XML ODT (text:list aninhável). */
function listToOdt(node: TipTapJSON, styles: TextStyleRegistry): string {
  const styleName = node.type === 'orderedList' ? 'Ln' : 'Lb'
  const items = (node.content ?? [])
    .map((item) => {
      const inner = (item.content ?? [])
        .map((child) =>
          child.type === 'bulletList' || child.type === 'orderedList'
            ? listToOdt(child, styles)
            : `<text:p>${inlineToOdt(child, styles)}</text:p>`
        )
        .join('')
      return `<text:list-item>${inner}</text:list-item>`
    })
    .join('')
  return `<text:list text:style-name="${styleName}">${items}</text:list>`
}

/** Converte uma tabela TipTap em XML ODT (table:table). */
function tableToOdt(node: TipTapJSON, styles: TextStyleRegistry): string {
  const rows = node.content ?? []
  const cols = rows[0]?.content?.length ?? 1
  const rowsXml = rows
    .map((row) => {
      const cells = (row.content ?? [])
        .map((cell) => {
          const inner = (cell.content ?? [])
            .map((child) => `<text:p>${inlineToOdt(child, styles)}</text:p>`)
            .join('')
          return `<table:table-cell office:value-type="string">${inner}</table:table-cell>`
        })
        .join('')
      return `<table:table-row>${cells}</table:table-row>`
    })
    .join('')
  return (
    `<table:table table:name="Tabela">` +
    `<table:table-column table:number-columns-repeated="${cols}"/>` +
    `${rowsXml}</table:table>`
  )
}

/** Converte um nó de bloco TipTap em XML ODT. */
function blockToOdt(node: TipTapJSON, styles: TextStyleRegistry): string {
  switch (node.type) {
    case 'paragraph':
      return `<text:p>${inlineToOdt(node, styles)}</text:p>`
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return (
        `<text:h text:style-name="Heading_20_${level}" text:outline-level="${level}">` +
        `${inlineToOdt(node, styles)}</text:h>`
      )
    }
    case 'blockquote':
      return (node.content ?? [])
        .map((child) => `<text:p text:style-name="Quotations">${inlineToOdt(child, styles)}</text:p>`)
        .join('')
    case 'codeBlock':
      return `<text:p text:style-name="Preformatted_20_Text">${inlineToOdt(node, styles)}</text:p>`
    case 'bulletList':
    case 'orderedList':
      return listToOdt(node, styles)
    case 'table':
      return tableToOdt(node, styles)
    case 'horizontalRule':
      return '<text:p text:style-name="Horizontal_20_Line"/>'
    default:
      return `<text:p>${inlineToOdt(node, styles)}</text:p>`
  }
}

/** Cabeçalho de namespaces usado em content.xml e styles.xml. */
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink"'

/** Estilos de lista (marcador e numeração) declarados no content.xml. */
const LIST_STYLES =
  '<text:list-style style:name="Lb">' +
  '<text:list-level-style-bullet text:level="1" text:bullet-char="•">' +
  '<style:list-level-properties text:space-before="0.6cm" text:min-label-width="0.4cm"/>' +
  '</text:list-level-style-bullet></text:list-style>' +
  '<text:list-style style:name="Ln">' +
  '<text:list-level-style-number text:level="1" style:num-format="1" text:num-suffix=".">' +
  '<style:list-level-properties text:space-before="0.6cm" text:min-label-width="0.4cm"/>' +
  '</text:list-level-style-number></text:list-style>'

/** Marcas de um run simples (sem tachado) de cabeçalho/rodapé. */
function runMarks(run: { bold: boolean; italic: boolean; underline: boolean }): RunMarks {
  return { bold: run.bold, italic: run.italic, underline: run.underline, strike: false }
}

/**
 * Converte o HTML de uma banda (cabeçalho/rodapé) em parágrafos ODT
 * (`text:p`), registrando os estilos de texto necessários. Devolve null se
 * a banda estiver vazia.
 */
function bandToOdt(html: string | undefined, styles: TextStyleRegistry): string | null {
  const lines = parseHeaderHtml(html ?? '')
  if (lines.length === 0) return null
  return lines
    .map((line) => {
      const inner = line.runs
        .map((run) => {
          const text = escapeXml(run.text)
          const name = styles.nameFor(runMarks(run))
          return name ? `<text:span text:style-name="${name}">${text}</text:span>` : text
        })
        .join('')
      return `<text:p>${inner}</text:p>`
    })
    .join('')
}

/** styles.xml com estilos nomeados, layout de página e cabeçalho/rodapé. */
function buildStylesXml(headerXml: string | null, footerXml: string | null, hfStyles: string): string {
  const headings = [1, 2, 3, 4, 5, 6]
    .map((level) => {
      const size = 22 - level * 2
      return (
        `<style:style style:name="Heading_20_${level}" style:display-name="Heading ${level}" ` +
        `style:family="paragraph" style:default-outline-level="${level}">` +
        `<style:text-properties fo:font-size="${size}pt" fo:font-weight="bold"/></style:style>`
      )
    })
    .join('')

  const pageLayout =
    '<style:page-layout style:name="PL1">' +
    '<style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" ' +
    'fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm" ' +
    'style:print-orientation="portrait"/>' +
    '<style:header-style><style:header-footer-properties fo:min-height="1cm" fo:margin-bottom="0.3cm"/></style:header-style>' +
    '<style:footer-style><style:header-footer-properties fo:min-height="1cm" fo:margin-top="0.3cm"/></style:footer-style>' +
    '</style:page-layout>'

  const masterPage =
    '<style:master-page style:name="Standard" style:page-layout-name="PL1">' +
    (headerXml ? `<style:header>${headerXml}</style:header>` : '') +
    (footerXml ? `<style:footer>${footerXml}</style:footer>` : '') +
    '</style:master-page>'

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<office:document-styles ${NS} office:version="1.2"><office:styles>` +
    '<style:style style:name="Standard" style:family="paragraph"/>' +
    headings +
    '<style:style style:name="Quotations" style:family="paragraph">' +
    '<style:paragraph-properties fo:margin-left="1cm"/>' +
    '<style:text-properties fo:font-style="italic"/></style:style>' +
    '<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph">' +
    '<style:text-properties style:font-name="Courier New" fo:font-family="\'Courier New\'"/></style:style>' +
    `</office:styles><office:automatic-styles>${pageLayout}${hfStyles}</office:automatic-styles>` +
    `<office:master-styles>${masterPage}</office:master-styles></office:document-styles>`
  )
}

/** manifest.xml listando os arquivos do pacote ODT. */
const MANIFEST_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
  `<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="${ODT_MIME}"/>` +
  '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
  '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>' +
  '</manifest:manifest>'

/** Converte um documento TipTap completo em um buffer .odt. */
export async function exportOdt(
  doc: TipTapJSON,
  options: { header?: string; footer?: string } = {}
): Promise<Buffer> {
  const styles = new TextStyleRegistry()
  const body = (doc.content ?? []).map((node) => blockToOdt(node, styles)).join('')

  // Estilos de texto do cabeçalho/rodapé vivem no styles.xml (registro próprio).
  const hfStyles = new TextStyleRegistry()
  const headerXml = bandToOdt(options.header, hfStyles)
  const footerXml = bandToOdt(options.footer, hfStyles)

  const content =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<office:document-content ${NS} office:version="1.2">` +
    `<office:automatic-styles>${LIST_STYLES}${styles.toXml()}</office:automatic-styles>` +
    `<office:body><office:text>${body || '<text:p/>'}</office:text></office:body>` +
    '</office:document-content>'

  const zip = new JSZip()
  // O mimetype deve ser o primeiro arquivo e estar sem compressão.
  zip.file('mimetype', ODT_MIME, { compression: 'STORE' })
  zip.file('META-INF/manifest.xml', MANIFEST_XML)
  zip.file('styles.xml', buildStylesXml(headerXml, footerXml, hfStyles.toXml()))
  zip.file('content.xml', content)

  return zip.generateAsync({ type: 'nodebuffer', mimeType: ODT_MIME }) as Promise<Buffer>
}

/* -------------------------------------------------------------------------- */
/* Importação — .odt → HTML                                                   */
/* -------------------------------------------------------------------------- */

/** Lê um atributo qualificado (com prefixo) de um elemento. */
function attr(el: Element, name: string): string | null {
  const value = el.getAttribute(name)
  if (value !== null) return value
  // Fallback: procura por nome local ignorando o prefixo.
  const local = name.split(':').pop() as string
  for (let i = 0; i < el.attributes.length; i += 1) {
    const a = el.attributes.item(i)
    if (a && (a.localName === local || a.name.endsWith(`:${local}`))) return a.value
  }
  return null
}

/** Lê o nome local de um nó (sem prefixo de namespace). */
function localName(node: Node): string {
  return (node as Element).localName ?? node.nodeName.split(':').pop() ?? node.nodeName
}

/** Mapeia nomes de estilo de texto para suas marcas (lido de automatic-styles). */
function buildStyleMaps(docEl: Element): {
  textStyles: Map<string, RunMarks>
  listStyles: Map<string, 'ol' | 'ul'>
} {
  const textStyles = new Map<string, RunMarks>()
  const listStyles = new Map<string, 'ol' | 'ul'>()

  const styleNodes = docEl.getElementsByTagName('*')
  for (let i = 0; i < styleNodes.length; i += 1) {
    const el = styleNodes.item(i) as Element
    const ln = localName(el)
    if (ln === 'style') {
      const name = attr(el, 'style:name')
      if (!name) continue
      const family = attr(el, 'style:family')
      if (family === 'text') {
        const props = findChild(el, 'text-properties')
        textStyles.set(name, {
          bold: props ? attr(props, 'fo:font-weight') === 'bold' : false,
          italic: props ? attr(props, 'fo:font-style') === 'italic' : false,
          underline: props
            ? (attr(props, 'style:text-underline-style') ?? 'none') !== 'none'
            : false,
          strike: props
            ? (attr(props, 'style:text-line-through-style') ?? 'none') !== 'none'
            : false
        })
      }
    } else if (ln === 'list-style') {
      const name = attr(el, 'style:name')
      if (!name) continue
      const ordered = Array.from(el.getElementsByTagName('*')).some(
        (n) => localName(n) === 'list-level-style-number'
      )
      listStyles.set(name, ordered ? 'ol' : 'ul')
    }
  }
  return { textStyles, listStyles }
}

/** Encontra o primeiro filho direto com o nome local informado. */
function findChild(el: Element, name: string): Element | null {
  for (let i = 0; i < el.childNodes.length; i += 1) {
    const child = el.childNodes.item(i)
    if (child.nodeType === 1 && localName(child) === name) return child as Element
  }
  return null
}

/** Aplica marcas a um trecho de HTML, aninhando as tags correspondentes. */
function wrapMarks(html: string, marks: RunMarks): string {
  let result = html
  if (marks.strike) result = `<s>${result}</s>`
  if (marks.underline) result = `<u>${result}</u>`
  if (marks.italic) result = `<em>${result}</em>`
  if (marks.bold) result = `<strong>${result}</strong>`
  return result
}

/** Converte os filhos inline de um elemento ODT em HTML. */
function inlineFromOdt(el: Element, textStyles: Map<string, RunMarks>): string {
  let html = ''
  for (let i = 0; i < el.childNodes.length; i += 1) {
    const child = el.childNodes.item(i)
    if (child.nodeType === 3) {
      html += escapeHtml(child.nodeValue ?? '')
    } else if (child.nodeType === 1) {
      const node = child as Element
      const ln = localName(node)
      if (ln === 'span') {
        const styleName = attr(node, 'text:style-name')
        const marks = styleName ? textStyles.get(styleName) : undefined
        const inner = inlineFromOdt(node, textStyles)
        html += marks ? wrapMarks(inner, marks) : inner
      } else if (ln === 'a') {
        const href = escapeHtml(attr(node, 'xlink:href') ?? '')
        html += `<a href="${href}">${inlineFromOdt(node, textStyles)}</a>`
      } else if (ln === 'line-break') {
        html += '<br>'
      } else if (ln === 's') {
        const count = Number(attr(node, 'text:c') ?? '1')
        html += '&nbsp;'.repeat(Number.isFinite(count) ? count : 1)
      } else if (ln === 'tab') {
        html += '&nbsp;&nbsp;&nbsp;&nbsp;'
      } else {
        html += inlineFromOdt(node, textStyles)
      }
    }
  }
  return html
}

/** Converte uma lista ODT em HTML (ul/ol), com aninhamento. */
function listFromOdt(
  el: Element,
  textStyles: Map<string, RunMarks>,
  listStyles: Map<string, 'ol' | 'ul'>
): string {
  const styleName = attr(el, 'text:style-name')
  const tag = (styleName && listStyles.get(styleName)) ?? 'ul'
  let items = ''
  for (let i = 0; i < el.childNodes.length; i += 1) {
    const child = el.childNodes.item(i)
    if (child.nodeType === 1 && localName(child) === 'list-item') {
      items += `<li>${blocksFromOdt(child as Element, textStyles, listStyles, true)}</li>`
    }
  }
  return `<${tag}>${items}</${tag}>`
}

/** Converte uma tabela ODT em HTML. */
function tableFromOdt(el: Element, textStyles: Map<string, RunMarks>): string {
  let rows = ''
  const rowEls = Array.from(el.getElementsByTagName('*')).filter(
    (n) => localName(n) === 'table-row'
  )
  rowEls.forEach((rowEl) => {
    let cells = ''
    for (let i = 0; i < rowEl.childNodes.length; i += 1) {
      const cell = rowEl.childNodes.item(i)
      if (cell.nodeType === 1 && localName(cell) === 'table-cell') {
        const inner = blocksFromOdt(cell as Element, textStyles, new Map(), false)
        cells += `<td>${inner}</td>`
      }
    }
    rows += `<tr>${cells}</tr>`
  })
  return `<table>${rows}</table>`
}

/** Converte os blocos filhos de um elemento ODT em HTML. */
function blocksFromOdt(
  el: Element,
  textStyles: Map<string, RunMarks>,
  listStyles: Map<string, 'ol' | 'ul'>,
  inlineOnly: boolean
): string {
  let html = ''
  for (let i = 0; i < el.childNodes.length; i += 1) {
    const child = el.childNodes.item(i)
    if (child.nodeType !== 1) continue
    const node = child as Element
    const ln = localName(node)
    switch (ln) {
      case 'h': {
        const level = Math.min(6, Math.max(1, Number(attr(node, 'text:outline-level') ?? '1')))
        html += `<h${level}>${inlineFromOdt(node, textStyles)}</h${level}>`
        break
      }
      case 'p': {
        const content = inlineFromOdt(node, textStyles)
        html += inlineOnly ? content : `<p>${content}</p>`
        break
      }
      case 'list':
        html += listFromOdt(node, textStyles, listStyles)
        break
      case 'table':
        html += tableFromOdt(node, textStyles)
        break
      case 'section':
        html += blocksFromOdt(node, textStyles, listStyles, false)
        break
      default:
        break
    }
  }
  return html
}

/** Converte um arquivo .odt (buffer) em HTML para o editor. */
export async function importOdt(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const contentFile = zip.file('content.xml')
  if (!contentFile) {
    throw new Error('Arquivo .odt inválido: content.xml ausente.')
  }
  const xml = await contentFile.async('string')
  const dom = new DOMParser().parseFromString(xml, 'text/xml')
  // O @xmldom/xmldom expõe uma API estruturalmente compatível com o DOM
  // padrão; tratamos os nós como Element/Node globais para a travessia.
  const root = dom.documentElement as unknown as Element
  if (!root) {
    throw new Error('Não foi possível interpretar o conteúdo do .odt.')
  }

  const { textStyles, listStyles } = buildStyleMaps(root)

  const textEls = Array.from(root.getElementsByTagName('*')).filter(
    (n) => localName(n) === 'text' && (n.parentNode as Element | null)?.localName === 'body'
  )
  const office = textEls[0]
  if (!office) return ''

  return blocksFromOdt(office, textStyles, listStyles, false)
}
