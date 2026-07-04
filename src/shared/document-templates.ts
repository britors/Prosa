// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { FileFormat } from './types.js'

export type DocumentTemplateCategory =
  | 'Acadêmico'
  | 'Corporativo'
  | 'Jurídico'
  | 'Operacional'
  | 'Editorial'

export interface DocumentTemplate {
  id: string
  name: string
  description: string
  category: DocumentTemplateCategory
  preferredFormat: Exclude<FileFormat, 'doc' | 'pdf'>
  documentName: string
  content: string
}

export interface DocumentTemplateChoice {
  kind: 'blank' | 'template'
  template?: DocumentTemplate
}

const TEMPLATE_LIST: DocumentTemplate[] = [
  {
    id: 'artigo',
    name: 'Artigo',
    description: 'Estrutura para artigo curto com resumo, seções e referências.',
    category: 'Acadêmico',
    preferredFormat: 'docx',
    documentName: 'Artigo.prosa',
    content: `
      <h1>Título do artigo</h1>
      <p><em>Subtítulo opcional</em></p>
      <h2>Resumo</h2>
      <p></p>
      <h2>Palavras-chave</h2>
      <p></p>
      <h2>Introdução</h2>
      <p></p>
      <h2>Desenvolvimento</h2>
      <p></p>
      <h2>Conclusão</h2>
      <p></p>
      <h2>Referências</h2>
      <p></p>
    `
  },
  {
    id: 'relatorio',
    name: 'Relatório',
    description: 'Modelo para relatórios com objetivo, análise e encaminhamentos.',
    category: 'Corporativo',
    preferredFormat: 'docx',
    documentName: 'Relatório.prosa',
    content: `
      <h1>Relatório</h1>
      <p><strong>Responsável:</strong> Nome do autor</p>
      <p><strong>Período:</strong> Data de início a data de fim</p>
      <h2>Resumo executivo</h2>
      <p></p>
      <h2>Contexto</h2>
      <p></p>
      <h2>Resultados</h2>
      <p></p>
      <h2>Próximos passos</h2>
      <p></p>
    `
  },
  {
    id: 'contrato',
    name: 'Contrato',
    description: 'Estrutura básica de contrato com cláusulas numeradas.',
    category: 'Jurídico',
    preferredFormat: 'odt',
    documentName: 'Contrato.prosa',
    content: `
      <h1>Contrato de prestação de serviços</h1>
      <p>Entre as partes qualificadas abaixo.</p>
      <h2>Cláusula 1 - Objeto</h2>
      <p></p>
      <h2>Cláusula 2 - Prazo</h2>
      <p></p>
      <h2>Cláusula 3 - Condições de pagamento</h2>
      <p></p>
      <h2>Cláusula 4 - Rescisão</h2>
      <p></p>
      <h2>Cláusula 5 - Foro</h2>
      <p></p>
    `
  },
  {
    id: 'ata',
    name: 'Ata',
    description: 'Ata de reunião com pauta, participantes e deliberações.',
    category: 'Operacional',
    preferredFormat: 'odt',
    documentName: 'Ata.prosa',
    content: `
      <h1>Ata de reunião</h1>
      <p><strong>Data:</strong> </p>
      <p><strong>Local:</strong> </p>
      <h2>Participantes</h2>
      <p></p>
      <h2>Pauta</h2>
      <p></p>
      <h2>Deliberações</h2>
      <p></p>
      <h2>Encerramento</h2>
      <p></p>
    `
  },
  {
    id: 'proposta-comercial',
    name: 'Proposta comercial',
    description: 'Proposta com escopo, entregas, cronograma e investimento.',
    category: 'Corporativo',
    preferredFormat: 'docx',
    documentName: 'Proposta-comercial.prosa',
    content: `
      <h1>Proposta comercial</h1>
      <p><strong>Cliente:</strong> </p>
      <p><strong>Data:</strong> </p>
      <h2>Resumo executivo</h2>
      <p></p>
      <h2>Escopo</h2>
      <p></p>
      <h2>Entregas</h2>
      <p></p>
      <h2>Cronograma</h2>
      <p></p>
      <h2>Investimento</h2>
      <p></p>
    `
  },
  {
    id: 'capitulo',
    name: 'Capítulo de livro',
    description: 'Estrutura para capítulo com introdução, desenvolvimento e fechamento.',
    category: 'Editorial',
    preferredFormat: 'docx',
    documentName: 'Capitulo-de-livro.prosa',
    content: `
      <h1>Capítulo 1 - Título do capítulo</h1>
      <p>Texto de abertura do capítulo.</p>
      <h2>Introdução</h2>
      <p></p>
      <h2>Desenvolvimento</h2>
      <p></p>
      <h2>Conclusão</h2>
      <p></p>
      <h2>Notas finais</h2>
      <p></p>
    `
  }
]

export const DOCUMENT_TEMPLATES = TEMPLATE_LIST

export function getDocumentTemplate(id: string): DocumentTemplate | undefined {
  return DOCUMENT_TEMPLATES.find((template) => template.id === id)
}
