import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatBibliographyEntry, parseBibTeX } from '../src/shared/bibliography.ts'

test('parseBibTeX extrai entradas básicas', () => {
  const entries = parseBibTeX(`
@article{silva2024,
  author = {Silva, Maria and Souza, Ana},
  title = {Estudo do texto},
  year = {2024},
  journal = {Revista Exemplo},
  volume = {12},
  number = {3},
  pages = {10-18},
  doi = {10.1234/exemplo}
}
  `)

  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, 'silva2024')
  assert.equal(entries[0].title, 'Estudo do texto')
  assert.equal(entries[0].author, 'Silva, Maria and Souza, Ana')
  assert.equal(entries[0].volume, '12')
  assert.equal(entries[0].number, '3')
  assert.equal(entries[0].pages, '10-18')
  assert.equal(entries[0].doi, '10.1234/exemplo')
})

test('formatBibliographyEntry gera saída legível', () => {
  const entry = {
    key: 'silva2024',
    type: 'article',
    title: 'Estudo do texto',
    author: 'Silva, Maria',
    year: '2024',
    journal: 'Revista Exemplo',
    volume: '12',
    number: '3',
    pages: '10-18',
    doi: '10.1234/exemplo',
    raw: ''
  }

  const abnt = formatBibliographyEntry(entry, 'ABNT')
  const apa = formatBibliographyEntry(entry, 'APA')
  const ieee = formatBibliographyEntry(entry, 'IEEE')

  assert.match(abnt, /Estudo do texto/)
  assert.match(apa, /\(2024\)/)
  assert.match(ieee, /\[1\]/)
  assert.match(abnt, /Revista Exemplo/)
  assert.match(abnt, /Disponível em:/)
})
