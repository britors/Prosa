// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import JSZip from 'jszip'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportEpub } from '../src/main/epub.ts'
import type { SavePayload, TipTapJSON } from '../src/shared/types.ts'

const imageDataUrl =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6kDfsAAAAASUVORK5CYII='

const doc: TipTapJSON = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Livro EPUB' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Primeiro parágrafo.' }] },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item um' }] }]
        }
      ]
    },
    { type: 'pageBreak' },
    {
      type: 'image',
      attrs: { src: imageDataUrl, alt: 'Miniatura', title: 'Imagem de teste' }
    }
  ]
}

const payload: SavePayload = {
  path: null,
  html: '',
  json: doc,
  text: 'Livro EPUB\nPrimeiro parágrafo.\nItem um',
  metadata: {
    title: 'Livro EPUB',
    author: 'Rodrigo Brito',
    createdAt: '2026-07-04T12:00:00.000Z',
    modifiedAt: '2026-07-04T12:30:00.000Z'
  },
  frontmatter: {
    language: 'pt-BR',
    description: 'Descrição do livro.'
  },
  notes: {}
}

test('exporta EPUB com estrutura padrão e metadados básicos', async () => {
  const buffer = await exportEpub(payload)
  assert.ok(buffer.length > 0)

  const zip = await JSZip.loadAsync(buffer)
  const entries = Object.keys(zip.files)

  assert.ok(entries.includes('mimetype'))
  assert.ok(entries.includes('META-INF/container.xml'))
  assert.ok(entries.includes('OEBPS/content.opf'))
  assert.ok(entries.includes('OEBPS/nav.xhtml'))
  assert.ok(entries.includes('OEBPS/text/chapter.xhtml'))
  assert.ok(entries.includes('OEBPS/images/img-1.png'))

  assert.equal(await zip.file('mimetype')?.async('string'), 'application/epub+zip')
  const opf = await zip.file('OEBPS/content.opf')?.async('string')
  assert.ok(opf)
  assert.match(opf, /<dc:title>Livro EPUB<\/dc:title>/)
  assert.match(opf, /<dc:creator>Rodrigo Brito<\/dc:creator>/)
  assert.match(opf, /<dc:language>pt-BR<\/dc:language>/)
  assert.match(opf, /<dc:description>Descrição do livro\.<\/dc:description>/)

  const nav = await zip.file('OEBPS/nav.xhtml')?.async('string')
  assert.ok(nav)
  assert.match(nav, /Livro EPUB/)
  assert.match(nav, /text\/chapter.xhtml#livro-epub/)

  const chapter = await zip.file('OEBPS/text/chapter.xhtml')?.async('string')
  assert.ok(chapter)
  assert.match(chapter, /<h1 id="livro-epub">Livro EPUB<\/h1>/)
  assert.match(chapter, /<p>Primeiro parágrafo\.<\/p>/)
  assert.match(chapter, /<li>.*Item um.*<\/li>/s)
  assert.match(chapter, /<div class="page-break"/)
  assert.match(chapter, /<img [^>]*src="\.\.\/images\/img-1\.png"/)
})

test('exporta EPUB com erro claro quando a imagem não é embutida', async () => {
  const invalid: SavePayload = {
    ...payload,
    json: {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: 'https://example.com/image.png', alt: 'Externa' }
        }
      ]
    },
    text: '',
    frontmatter: {}
  }

  await assert.rejects(() => exportEpub(invalid), /data URL/)
})
