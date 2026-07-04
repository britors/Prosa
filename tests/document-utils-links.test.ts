import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractCitations, extractWikilinks } from '../src/shared/document-utils.ts'

test('extractCitations lê marcas citation no JSON do documento', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Texto',
            marks: [{ type: 'citation', attrs: { citeKey: 'silva2024' } }]
          }
        ]
      }
    ]
  }

  assert.deepEqual(extractCitations(doc as never), ['silva2024'])
})

test('extractWikilinks lê marcas wikilink no JSON do documento', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Ligação',
            marks: [{ type: 'wikilink', attrs: { href: 'prosa://wiki/Documento%20A' } }]
          }
        ]
      }
    ]
  }

  assert.deepEqual(extractWikilinks(doc as never), ['Documento A'])
})

