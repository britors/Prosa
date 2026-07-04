import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportHtml } from '../src/main/html-export.ts'

test('exportHtml gera documento completo com conteúdo semântico', () => {
  const html = exportHtml(
    {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Título' }] },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Texto ',
              marks: [{ type: 'bold' }]
            },
            {
              type: 'text',
              text: 'com link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }]
            }
          ]
        },
        { type: 'mathBlock', attrs: { latex: 'a^2+b^2=c^2' } }
      ]
    },
    { mode: 'full', includeStyles: true, title: 'Meu documento' }
  )

  assert.match(html, /<!doctype html>/i)
  assert.match(html, /<h1 id="titulo">Título<\/h1>/)
  assert.match(html, /<strong>Texto <\/strong>/)
  assert.match(html, /<a href="https:\/\/example.com">com link<\/a>/)
  assert.match(html, /katex/)
})

test('exportHtml pode gerar somente o conteúdo', () => {
  const html = exportHtml(
    {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Corpo' }] }]
    },
    { mode: 'content', includeStyles: false }
  )

  assert.equal(html.trim(), '<p>Corpo</p>')
})

