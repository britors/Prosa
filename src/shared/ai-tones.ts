// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

export interface AiToneOption {
  value: string
  label: string
}

export const AI_TONE_OPTIONS: readonly AiToneOption[] = [
  { value: 'formal', label: 'Formal' },
  { value: 'profissional', label: 'Profissional' },
  { value: 'acadêmico', label: 'Acadêmico' },
  { value: 'técnico', label: 'Técnico' },
  { value: 'claro e simples', label: 'Claro e simples' },
  { value: 'conciso', label: 'Conciso' },
  { value: 'persuasivo', label: 'Persuasivo' },
  { value: 'criativo', label: 'Criativo' },
  { value: 'jornalístico', label: 'Jornalístico' },
  { value: 'amigável', label: 'Amigável' }
]
