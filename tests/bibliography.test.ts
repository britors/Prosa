import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatBibliographyEntry, parseBibTeX } from '../src/shared/bibliography.ts'

test('parseBibTeX extrai entradas básicas', () => {
  const entries = parseBibTeX(`
@article{silva2024,
  author = {Silva, Maria and Souza, Ana},
  title = {Estudo do texto},
  year = {2024},
  journal = {Revista Exemplo}
}
  `)

  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, 'silva2024')
  assert.equal(entries[0].title, 'Estudo do texto')
  assert.equal(entries[0].author, 'Silva, Maria and Souza, Ana')
})

test('formatBibliographyEntry gera saída legível', () => {
  const entry = {
    key: 'silva2024',
    type: 'article',
    title: 'Estudo do texto',
    author: 'Silva, Maria',
    year: '2024',
    journal: 'Revista Exemplo',
    raw: ''
  }

  const abnt = formatBibliographyEntry(entry, 'ABNT')
  const apa = formatBibliographyEntry(entry, 'APA')
  const ieee = formatBibliographyEntry(entry, 'IEEE')

  assert.match(abnt, /Estudo do texto/)
  assert.match(apa, /\(2024\)/)
  assert.match(ieee, /\[1\]/)
})

