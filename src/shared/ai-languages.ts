// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

export interface AiLanguageOption {
  value: string
  label: string
}

export const AI_TRANSLATION_LANGUAGES: readonly AiLanguageOption[] = [
  { value: 'português do Brasil', label: 'Português do Brasil' },
  { value: 'inglês', label: 'Inglês' },
  { value: 'espanhol', label: 'Espanhol' },
  { value: 'francês', label: 'Francês' },
  { value: 'alemão', label: 'Alemão' },
  { value: 'italiano', label: 'Italiano' },
  { value: 'japonês', label: 'Japonês' },
  { value: 'chinês simplificado', label: 'Chinês simplificado' },
  { value: 'coreano', label: 'Coreano' },
  { value: 'árabe', label: 'Árabe' },
  { value: 'russo', label: 'Russo' }
]
