// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportDocx, importDocx, exportMarkdown, importMarkdown } from '../src/main/converters.ts'
import { exportOdt, importOdt } from '../src/main/odt.ts'
import { exportRtf, importRtf } from '../src/main/rtf.ts'
import type { TipTapJSON } from '../src/shared/types.ts'

// Mesmos caracteres que a extensão Typography do TipTap produz ao digitar
// aspas retas, travessão duplo e reticências (src/renderer/editor/editor.ts).
const SMART_TEXT = '“aspas duplas” e ‘aspas simples’ — reticências…'

const doc: TipTapJSON = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: SMART_TEXT }] }]
}

test('round-trip Markdown preserva aspas curvas, travessão e reticências', () => {
  const md = exportMarkdown(doc)
  const html = importMarkdown(md)
  assert.match(html, /“aspas duplas”/)
  assert.match(html, /‘aspas simples’/)
  assert.match(html, /—/)
  assert.match(html, /…/)
})

test('round-trip .docx preserva aspas curvas, travessão e reticências', async () => {
  const buffer = await exportDocx(doc)
  const html = await importDocx(buffer)
  assert.match(html, /“aspas duplas”/)
  assert.match(html, /‘aspas simples’/)
  assert.match(html, /—/)
  assert.match(html, /…/)
})

test('round-trip .odt preserva aspas curvas, travessão e reticências', async () => {
  const buffer = await exportOdt(doc)
  const html = await importOdt(buffer)
  assert.match(html, /“aspas duplas”/)
  assert.match(html, /‘aspas simples’/)
  assert.match(html, /—/)
  assert.match(html, /…/)
})

test('round-trip .rtf preserva aspas curvas, travessão e reticências', () => {
  const rtf = exportRtf(doc)
  const html = importRtf(rtf)
  assert.match(html, /“aspas duplas”/)
  assert.match(html, /‘aspas simples’/)
  assert.match(html, /—/)
  assert.match(html, /…/)
})
