// Prosa — Editor de Texto
// Copyright (C) 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { parseHeaderHtml } from '../src/main/html-runs.ts'
import { exportDocx } from '../src/main/converters.ts'
import { exportOdt } from '../src/main/odt.ts'
import type { TipTapJSON } from '../src/shared/types.ts'

const doc: TipTapJSON = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Corpo do documento.' }] }]
}

/** Concatena o texto de todos os arquivos XML de um pacote zip. */
async function allXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const parts: string[] = []
  for (const name of Object.keys(zip.files)) {
    if (name.endsWith('.xml')) {
      parts.push(`@@${name}@@` + (await zip.files[name].async('string')))
    }
  }
  return parts.join('\n')
}

test('parseHeaderHtml separa runs e detecta negrito', () => {
  const lines = parseHeaderHtml('Olá <b>mundo</b>')
  assert.equal(lines.length, 1)
  assert.equal(lines[0].runs.length, 2)
  assert.equal(lines[0].runs[0].text, 'Olá ')
  assert.equal(lines[0].runs[0].bold, false)
  assert.equal(lines[0].runs[1].text, 'mundo')
  assert.equal(lines[0].runs[1].bold, true)
})

test('parseHeaderHtml quebra blocos em linhas e ignora HTML vazio', () => {
  assert.equal(parseHeaderHtml('<div>linha 1</div><div>linha 2</div>').length, 2)
  assert.equal(parseHeaderHtml('').length, 0)
  assert.equal(parseHeaderHtml('   ').length, 0)
})

test('.docx exportado contém o cabeçalho e o rodapé', async () => {
  const buffer = await exportDocx(doc, {
    header: 'Cabeçalho W3TI',
    footer: 'Rodapé Prosa'
  })
  const xml = await allXml(buffer)
  assert.match(xml, /header\d*\.xml/)
  assert.match(xml, /Cabeçalho W3TI/)
  assert.match(xml, /footer\d*\.xml/)
  assert.match(xml, /Rodapé Prosa/)
})

test('.docx sem cabeçalho/rodapé não falha', async () => {
  const buffer = await exportDocx(doc)
  assert.ok(buffer.length > 0)
  assert.equal(buffer[0], 0x50)
})

test('.odt exportado embute cabeçalho/rodapé no styles.xml', async () => {
  const buffer = await exportOdt(doc, {
    header: 'Cabeçalho W3TI',
    footer: 'Rodapé Prosa'
  })
  const zip = await JSZip.loadAsync(buffer)
  const styles = await zip.files['styles.xml'].async('string')
  assert.match(styles, /<style:master-page/)
  assert.match(styles, /<style:header>/)
  assert.match(styles, /Cabeçalho W3TI/)
  assert.match(styles, /<style:footer>/)
  assert.match(styles, /Rodapé Prosa/)
})

test('.odt mantém negrito do cabeçalho como estilo de texto', async () => {
  const buffer = await exportOdt(doc, { header: 'Texto <b>forte</b>' })
  const zip = await JSZip.loadAsync(buffer)
  const styles = await zip.files['styles.xml'].async('string')
  assert.match(styles, /<text:span text:style-name="T\d+">forte<\/text:span>/)
  assert.match(styles, /fo:font-weight="bold"/)
})
