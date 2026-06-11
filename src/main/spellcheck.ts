// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { Menu, MenuItem, session, type BrowserWindow } from 'electron'

/**
 * Configura o corretor ortográfico nativo do Chromium para os idiomas
 * informados. No macOS o corretor é o do sistema (a lista é ignorada). Em
 * Linux/Windows o Electron baixa/usa dicionários Hunspell automaticamente.
 */
export function configureSpellChecker(enabled: boolean, languages: string[]): void {
  const ses = session.defaultSession
  try {
    if (!enabled) {
      ses.setSpellCheckerLanguages([])
      return
    }
    const available = ses.availableSpellCheckerLanguages
    const supported = languages.filter((lang) => available.includes(lang))
    ses.setSpellCheckerLanguages(supported.length > 0 ? supported : ['pt-BR'])
  } catch {
    // macOS (ou plataforma sem suporte à API) — usa o corretor do sistema.
  }
}

/**
 * Conecta o menu de contexto do editor: ao clicar com o botão direito sobre
 * uma palavra sublinhada, exibe as sugestões de correção, a opção de
 * adicionar ao dicionário e os comandos de edição (recortar/copiar/colar).
 */
export function attachSpellCheckContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu()

    // Sugestões de correção para a palavra com erro ortográfico.
    for (const suggestion of params.dictionarySuggestions) {
      menu.append(
        new MenuItem({
          label: suggestion,
          click: () => window.webContents.replaceMisspelling(suggestion)
        })
      )
    }

    if (params.misspelledWord) {
      if (params.dictionarySuggestions.length === 0) {
        menu.append(new MenuItem({ label: 'Nenhuma sugestão', enabled: false }))
      }
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(
        new MenuItem({
          label: 'Adicionar ao dicionário',
          click: () =>
            session.defaultSession.addWordToSpellCheckerDictionary(params.misspelledWord)
        })
      )
    }

    // Comandos de edição padrão.
    if (params.isEditable || params.selectionText) {
      if (menu.items.length > 0) {
        menu.append(new MenuItem({ type: 'separator' }))
      }
      if (params.isEditable) {
        menu.append(new MenuItem({ role: 'cut', label: 'Recortar', enabled: params.editFlags.canCut }))
      }
      menu.append(new MenuItem({ role: 'copy', label: 'Copiar', enabled: params.editFlags.canCopy }))
      if (params.isEditable) {
        menu.append(new MenuItem({ role: 'paste', label: 'Colar', enabled: params.editFlags.canPaste }))
      }
    }

    if (menu.items.length > 0) {
      menu.popup({ window })
    }
  })
}
