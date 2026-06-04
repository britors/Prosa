// Prosa — Editor de Texto
// Copyright (C) 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
// SPDX-License-Identifier: GPL-3.0-or-later

import type { TipTapJSON } from '../shared/types.js'

/**
 * Suporte a Rich Text Format (.rtf) — formato lido e gravado tanto pelo
 * Microsoft Word quanto pelo LibreOffice Writer. A exportação preserva
 * negrito, itálico, sublinhado, tachado, títulos (como texto realçado),
 * listas e citações; a importação reconstrói a formatação inline básica.
 */

/* -------------------------------------------------------------------------- */
/* Exportação — TipTap JSON → .rtf                                            */
/* -------------------------------------------------------------------------- */

/** Escapa caracteres especiais do RTF e converte não-ASCII em \uN. */
function escapeRtf(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '\\' || ch === '{' || ch === '}') {
      out += `\\${ch}`
    } else if (code === 0x0a) {
      out += '\\line '
    } else if (code < 128) {
      out += ch
    } else {
      // RTF usa inteiros com sinal de 16 bits; valores > 32767 viram negativos.
      const signed = code > 32767 ? code - 65536 : code
      out += `\\u${signed}?`
    }
  }
  return out
}

/** Converte os nós inline de um bloco em RTF, aplicando as marcas. */
function inlineToRtf(node: TipTapJSON): string {
  const out: string[] = []

  const visit = (child: TipTapJSON): void => {
    if (child.type === 'text') {
      const marks = child.marks ?? []
      const has = (type: string): boolean => marks.some((m) => m.type === type)
      const on: string[] = []
      const off: string[] = []
      if (has('bold')) {
        on.push('\\b')
        off.unshift('\\b0')
      }
      if (has('italic')) {
        on.push('\\i')
        off.unshift('\\i0')
      }
      if (has('underline')) {
        on.push('\\ul')
        off.unshift('\\ulnone')
      }
      if (has('strike')) {
        on.push('\\strike')
        off.unshift('\\strike0')
      }
      const text = escapeRtf(child.text ?? '')
      out.push(`${on.join('')}${on.length ? ' ' : ''}${text}${off.join('')}`)
    } else if (child.type === 'hardBreak') {
      out.push('\\line ')
    } else {
      ;(child.content ?? []).forEach(visit)
    }
  }

  ;(node.content ?? []).forEach(visit)
  return out.join('')
}

/** Converte um nó de bloco TipTap em um parágrafo RTF. */
function blockToRtf(node: TipTapJSON, listPrefix = ''): string {
  switch (node.type) {
    case 'paragraph':
      return `\\pard\\sa180 ${listPrefix}${inlineToRtf(node)}\\par\n`
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      const size = (20 - level * 2) * 2 // meio-pontos
      return `\\pard\\sa180\\sb120\\b\\fs${size} ${inlineToRtf(node)}\\b0\\fs24\\par\n`
    }
    case 'blockquote':
      return (node.content ?? [])
        .map((child) => `\\pard\\li720\\sa180\\i ${inlineToRtf(child)}\\i0\\par\n`)
        .join('')
    case 'codeBlock':
      return `\\pard\\sa180\\f1 ${inlineToRtf(node)}\\f0\\par\n`
    case 'bulletList':
      return (node.content ?? [])
        .map((item) =>
          (item.content ?? [])
            .map((child) => blockToRtf(child, '\\bullet\\tab '))
            .join('')
        )
        .join('')
    case 'orderedList':
      return (node.content ?? [])
        .map((item, idx) =>
          (item.content ?? [])
            .map((child) => blockToRtf(child, `${idx + 1}.\\tab `))
            .join('')
        )
        .join('')
    case 'table':
      return tableToRtf(node)
    case 'horizontalRule':
      return '\\pard\\brdrb\\brdrs\\brdrw10\\par\n'
    default:
      return `\\pard\\sa180 ${inlineToRtf(node)}\\par\n`
  }
}

/** Converte uma tabela TipTap em linhas RTF simples. */
function tableToRtf(node: TipTapJSON): string {
  const rows = node.content ?? []
  let out = ''
  for (const row of rows) {
    const cells = row.content ?? []
    const cellCount = cells.length
    const width = Math.floor(9000 / Math.max(1, cellCount))
    let header = '\\trowd\\trgaph100'
    for (let i = 0; i < cellCount; i += 1) {
      header += `\\cellx${width * (i + 1)}`
    }
    let body = ''
    for (const cell of cells) {
      const text = (cell.content ?? []).map((c) => inlineToRtf(c)).join(' ')
      body += `\\pard\\intbl ${text}\\cell `
    }
    out += `${header}\n${body}\\row\n`
  }
  return out
}

/** Converte um documento TipTap completo em uma string .rtf. */
export function exportRtf(doc: TipTapJSON): string {
  const body = (doc.content ?? []).map((node) => blockToRtf(node)).join('')
  return (
    '{\\rtf1\\ansi\\ansicpg1252\\deff0' +
    '{\\fonttbl{\\f0\\froman Times New Roman;}{\\f1\\fmodern Courier New;}}' +
    '\\fs24\n' +
    body +
    '}'
  )
}

/* -------------------------------------------------------------------------- */
/* Importação — .rtf → HTML                                                    */
/* -------------------------------------------------------------------------- */

/** Estado de formatação corrente durante a análise do RTF. */
interface RtfState {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  ignore: boolean
  /** Quantidade de caracteres de fallback a ignorar após um \uN (\ucN). */
  uc: number
}

/** Destinos do RTF cujo conteúdo deve ser ignorado por completo. */
const IGNORED_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'header',
  'footer',
  'headerl',
  'headerr',
  'footerl',
  'footerr',
  'generator',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'object',
  'fldinst'
])

/** Aplica as marcas ativas a um trecho de texto, gerando HTML. */
function wrapRtfMarks(text: string, state: RtfState): string {
  let html = text
  if (state.strike) html = `<s>${html}</s>`
  if (state.underline) html = `<u>${html}</u>`
  if (state.italic) html = `<em>${html}</em>`
  if (state.bold) html = `<strong>${html}</strong>`
  return html
}

/** Escapa texto para HTML seguro. */
function htmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Converte uma string .rtf em HTML para alimentar o editor. */
export function importRtf(rtf: string): string {
  const stack: RtfState[] = []
  let state: RtfState = {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    ignore: false,
    uc: 1
  }
  // Caracteres de fallback pendentes a ignorar após um \uN.
  let skip = 0

  const paragraphs: string[] = []
  let runs: string[] = []
  let buffer = ''

  /** Descarrega o texto acumulado como um run formatado. */
  const flushRun = (): void => {
    if (buffer.length > 0) {
      if (!state.ignore) runs.push(wrapRtfMarks(htmlEscape(buffer), state))
      buffer = ''
    }
  }

  /** Encerra o parágrafo corrente. */
  const flushParagraph = (): void => {
    flushRun()
    paragraphs.push(`<p>${runs.join('')}</p>`)
    runs = []
  }

  let i = 0
  const n = rtf.length
  while (i < n) {
    const ch = rtf[i]
    // Ignora os caracteres de fallback que seguem um \uN (contagem \ucN).
    if (skip > 0 && ch !== '{' && ch !== '}') {
      if (ch === '\\') {
        // Um token de controle inteiro conta como um caractere de fallback.
        let j = i + 1
        if (/[a-zA-Z]/.test(rtf[j] ?? '')) {
          while (j < n && /[a-zA-Z]/.test(rtf[j])) j += 1
          if (rtf[j] === '-' || /[0-9]/.test(rtf[j] ?? '')) {
            if (rtf[j] === '-') j += 1
            while (j < n && /[0-9]/.test(rtf[j])) j += 1
          }
          if (rtf[j] === ' ') j += 1
        } else if (rtf[j] === "'") {
          j += 3
        } else {
          j += 1
        }
        i = j
      } else {
        i += 1
      }
      skip -= 1
      continue
    }
    if (ch === '{') {
      flushRun()
      stack.push({ ...state })
      i += 1
    } else if (ch === '}') {
      flushRun()
      const popped = stack.pop()
      if (popped) state = popped
      i += 1
    } else if (ch === '\\') {
      // Símbolo ou palavra de controle.
      const next = rtf[i + 1]
      if (next === '\\' || next === '{' || next === '}') {
        if (!state.ignore) buffer += next
        i += 2
      } else if (next === '*') {
        flushRun()
        state.ignore = true
        i += 2
      } else if (next === "'") {
        // Byte hexadecimal (\'hh) na página de código atual.
        const hex = rtf.slice(i + 2, i + 4)
        const code = parseInt(hex, 16)
        if (!Number.isNaN(code) && !state.ignore) buffer += String.fromCharCode(code)
        i += 4
      } else if (next === '~') {
        if (!state.ignore) buffer += ' '
        i += 2
      } else if (next === '-' || next === '_') {
        i += 2
      } else if (/[a-zA-Z]/.test(next ?? '')) {
        // Palavra de controle: letras seguidas de parâmetro numérico opcional.
        let j = i + 1
        while (j < n && /[a-zA-Z]/.test(rtf[j])) j += 1
        const word = rtf.slice(i + 1, j)
        let param = ''
        if (rtf[j] === '-' || /[0-9]/.test(rtf[j] ?? '')) {
          let k = j
          if (rtf[k] === '-') k += 1
          while (k < n && /[0-9]/.test(rtf[k])) k += 1
          param = rtf.slice(j, k)
          j = k
        }
        // Um único espaço após a palavra de controle é delimitador e some.
        if (rtf[j] === ' ') j += 1
        i = j
        applyControlWord(word, param)
      } else {
        i += 2
      }
    } else if (ch === '\r' || ch === '\n') {
      i += 1
    } else {
      if (!state.ignore) buffer += ch
      i += 1
    }
  }

  /** Interpreta uma palavra de controle e atualiza o estado. */
  function applyControlWord(word: string, param: string): void {
    if (IGNORED_DESTINATIONS.has(word)) {
      flushRun()
      state.ignore = true
      return
    }
    switch (word) {
      case 'par':
      case 'sect':
        flushParagraph()
        break
      case 'pard':
        // Reinício de propriedades de parágrafo (mantemos as marcas inline).
        break
      case 'line':
        flushRun()
        runs.push('<br>')
        break
      case 'tab':
        if (!state.ignore) buffer += '    '
        break
      case 'b':
        flushRun()
        state.bold = param !== '0'
        break
      case 'i':
        flushRun()
        state.italic = param !== '0'
        break
      case 'ul':
        flushRun()
        state.underline = true
        break
      case 'ulnone':
        flushRun()
        state.underline = false
        break
      case 'strike':
        flushRun()
        state.strike = param !== '0'
        break
      case 'uc':
        state.uc = Math.max(0, parseInt(param, 10) || 0)
        break
      case 'u': {
        // Caractere Unicode (\uN), seguido de \ucN caracteres de fallback.
        if (param) {
          let code = parseInt(param, 10)
          if (code < 0) code += 65536
          if (!state.ignore) buffer += String.fromCharCode(code)
          skip = state.uc
        }
        break
      }
      case 'cell':
        if (!state.ignore) buffer += ' '
        break
      case 'row':
        flushParagraph()
        break
      default:
        break
    }
  }

  // Encerra qualquer parágrafo pendente sem \par final.
  flushRun()
  if (runs.length > 0) {
    paragraphs.push(`<p>${runs.join('')}</p>`)
  }

  const html = paragraphs.filter((p) => p !== '<p></p>').join('\n')
  return html.length > 0 ? html : '<p></p>'
}
