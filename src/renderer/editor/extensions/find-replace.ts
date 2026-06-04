// Prosa — Editor de Texto
// Copyright (C) 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
// SPDX-License-Identifier: GPL-3.0-or-later

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** Opções de busca configuráveis pelo usuário. */
export interface SearchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

/** Intervalo (em posições do documento) de uma ocorrência encontrada. */
export interface MatchRange {
  from: number
  to: number
}

interface SearchState {
  term: string
  options: SearchOptions
  matches: MatchRange[]
  current: number
  decorations: DecorationSet
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      setSearchTerm: (term: string, options: SearchOptions) => ReturnType
      clearSearch: () => ReturnType
      findNext: () => ReturnType
      findPrevious: () => ReturnType
      replaceCurrent: (replacement: string) => ReturnType
      replaceAll: (replacement: string) => ReturnType
    }
  }
}

export const findReplaceKey = new PluginKey<SearchState>('prosaFindReplace')

/** Escapa caracteres especiais de regex em uma string literal. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Constrói a expressão regular de busca a partir do termo e das opções. */
function buildRegex(term: string, options: SearchOptions): RegExp | null {
  if (!term) return null
  let pattern = options.regex ? term : escapeRegExp(term)
  if (options.wholeWord) {
    pattern = `\\b${pattern}\\b`
  }
  const flags = options.caseSensitive ? 'g' : 'gi'
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

/** Percorre o documento e coleta todas as ocorrências do termo. */
function findMatches(
  doc: import('@tiptap/pm/model').Node,
  term: string,
  options: SearchOptions
): MatchRange[] {
  const regex = buildRegex(term, options)
  if (!regex) return []
  const matches: MatchRange[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const text = node.text
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const from = pos + match.index
      matches.push({ from, to: from + match[0].length })
      if (match.index === regex.lastIndex) regex.lastIndex += 1
    }
  })
  return matches
}

/** Gera o conjunto de decorações de destaque para as ocorrências. */
function buildDecorations(
  doc: import('@tiptap/pm/model').Node,
  matches: MatchRange[],
  current: number
): DecorationSet {
  const decorations = matches.map((match, index) =>
    Decoration.inline(match.from, match.to, {
      class: index === current ? 'prosa-search-current' : 'prosa-search-match'
    })
  )
  return DecorationSet.create(doc, decorations)
}

/**
 * Extensão de Localizar & Substituir. Mantém o termo de busca e as
 * ocorrências como decorações ProseMirror, permitindo navegação e
 * substituição (atual ou todas).
 */
export const FindReplace = Extension.create({
  name: 'findReplace',

  addOptions() {
    return {
      onMatchesUpdate: (_current: number, _total: number) => {}
    }
  },

  addProseMirrorPlugins() {
    const extension = this
    return [
      new Plugin<SearchState>({
        key: findReplaceKey,
        state: {
          init: (): SearchState => ({
            term: '',
            options: { caseSensitive: false, wholeWord: false, regex: false },
            matches: [],
            current: 0,
            decorations: DecorationSet.empty
          }),
          apply(tr, value): SearchState {
            const meta = tr.getMeta(findReplaceKey) as Partial<SearchState> | undefined
            let next = value
            if (meta) {
              next = { ...value, ...meta }
            }
            if (meta || tr.docChanged) {
              const matches = findMatches(tr.doc, next.term, next.options)
              const current = matches.length === 0 ? 0 : Math.min(next.current, matches.length - 1)
              next = {
                ...next,
                matches,
                current,
                decorations: buildDecorations(tr.doc, matches, current)
              }
              extension.options.onMatchesUpdate(
                matches.length === 0 ? 0 : current + 1,
                matches.length
              )
            }
            return next
          }
        },
        props: {
          decorations(state) {
            return findReplaceKey.getState(state)?.decorations
          }
        }
      })
    ]
  },

  addCommands() {
    return {
      setSearchTerm:
        (term: string, options: SearchOptions) =>
        ({ state, dispatch }) => {
          if (dispatch) {
            dispatch(state.tr.setMeta(findReplaceKey, { term, options, current: 0 }))
          }
          return true
        },
      clearSearch:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) {
            dispatch(
              state.tr.setMeta(findReplaceKey, {
                term: '',
                matches: [],
                current: 0,
                decorations: DecorationSet.empty
              })
            )
          }
          return true
        },
      findNext:
        () =>
        ({ state, dispatch, view }) => {
          const search = findReplaceKey.getState(state)
          if (!search || search.matches.length === 0) return false
          const current = (search.current + 1) % search.matches.length
          if (dispatch) {
            dispatch(state.tr.setMeta(findReplaceKey, { current }))
          }
          scrollToMatch(view, search.matches[current])
          return true
        },
      findPrevious:
        () =>
        ({ state, dispatch, view }) => {
          const search = findReplaceKey.getState(state)
          if (!search || search.matches.length === 0) return false
          const current =
            (search.current - 1 + search.matches.length) % search.matches.length
          if (dispatch) {
            dispatch(state.tr.setMeta(findReplaceKey, { current }))
          }
          scrollToMatch(view, search.matches[current])
          return true
        },
      replaceCurrent:
        (replacement: string) =>
        ({ state, dispatch }) => {
          const search = findReplaceKey.getState(state)
          if (!search || search.matches.length === 0) return false
          const match = search.matches[search.current]
          if (dispatch) {
            dispatch(state.tr.insertText(replacement, match.from, match.to))
          }
          return true
        },
      replaceAll:
        (replacement: string) =>
        ({ state, dispatch }) => {
          const search = findReplaceKey.getState(state)
          if (!search || search.matches.length === 0) return false
          if (dispatch) {
            const tr = state.tr
            // Substitui de trás para frente para preservar as posições.
            for (let i = search.matches.length - 1; i >= 0; i -= 1) {
              const match = search.matches[i]
              tr.insertText(replacement, match.from, match.to)
            }
            dispatch(tr)
          }
          return true
        }
    }
  }
})

/** Rola a visão do editor até a ocorrência indicada. */
function scrollToMatch(
  view: import('@tiptap/pm/view').EditorView,
  match: MatchRange
): void {
  const dom = view.domAtPos(match.from)
  const node = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement
  node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
