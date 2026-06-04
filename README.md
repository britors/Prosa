<div align="center">

# Prosa

### Escreva. Formate. Publique.

**Editor de texto moderno, open source e em modo escuro — parte da suíte de escritório W3TI.**

[![Licença: GPL v3](https://img.shields.io/badge/Licen%C3%A7a-GPLv3-06B6D4.svg)](LICENSE)
![Electron](https://img.shields.io/badge/Electron-34-0891B2.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-06B6D4.svg)

</div>

---

O **Prosa** é um processador de texto desktop construído com Electron e TypeScript,
com foco em uma experiência de uso moderna, modo escuro elegante e um código-fonte
limpo e tipado. Ele compete com o LibreOffice Writer e o Microsoft Word, mas com a
leveza e a estética de um editor atual.

O editor é construído sobre o [TipTap](https://tiptap.dev) (ProseMirror) e suporta
importação e exportação de `.docx`, Markdown, texto puro e PDF.

## ✨ Funcionalidades

- 📝 **Edição rica** — títulos (H1–H6), negrito, itálico, sublinhado, tachado,
  sobrescrito, subscrito, cores, realce, tamanhos e **todas as fontes
  instaladas no computador** (com pré-visualização no seletor).
- 📐 **Página A4 simulada** — área de edição com margens e dimensões reais.
- 🖼️ **Imagens** — inserir por arquivo, arrastar-e-soltar ou colar (embutidas
  no documento como base64).
- 📰 **Cabeçalho e rodapé** — bandas editáveis da página, salvas no documento,
  repetidas em todas as páginas na impressão/PDF e exportadas como cabeçalho e
  rodapé nativos do `.docx` (Word) e do `.odt` (LibreOffice).
- 📑 **Painel de tópicos** — outline automático dos títulos do documento, com
  navegação por clique.
- 🎨 **Estilos de parágrafo** — Normal, Títulos, Citação, Bloco de código.
- 🔍 **Localizar & Substituir** — com diferenciação de maiúsculas, palavra inteira
  e expressões regulares.
- ✅ **Corretor ortográfico** — sublinha palavras erradas (pt-BR e en-US) e, com
  o botão direito, mostra sugestões de correção e "adicionar ao dicionário".
- 🖨️ **Impressão** — diálogo de impressão do sistema (Ctrl+P) com saída em
  papel branco e texto preto.
- 📊 **Barra de status** — contagem de palavras, caracteres, tempo de leitura,
  páginas, posição do cursor e zoom.
- 📥 **Importação** — `.docx` (Word), `.odt` (LibreOffice/OpenDocument),
  `.rtf`, `.doc` (Word 97-2003, somente leitura), Markdown e texto puro.
- 📤 **Exportação** — `.docx`, `.odt`, `.rtf`, Markdown, texto e PDF (printToPDF).
- 💾 **Formato nativo `.prosa`** — JSON com o documento TipTap e metadados.
- 🗂️ **Arquivos recentes** e tela de boas-vindas com arrastar-e-soltar.
- 🌙 **Modo escuro** dedicado, com a identidade visual da W3TI.

## 📁 Compatibilidade de formatos

O Prosa abre e salva os formatos padrão do **Microsoft Office** e do
**LibreOffice**:

| Formato | Extensão | Abrir | Salvar | Origem |
| --- | --- | :---: | :---: | --- |
| Prosa (nativo) | `.prosa` | ✅ | ✅ | JSON (TipTap + metadados) |
| Word | `.docx` | ✅ | ✅ | Microsoft Office |
| OpenDocument Text | `.odt` | ✅ | ✅ | LibreOffice / OpenOffice |
| Rich Text | `.rtf` | ✅ | ✅ | Word e LibreOffice |
| Word 97-2003 | `.doc` | ⚠️ | — | Legado (leitura do texto) |
| Markdown | `.md` | ✅ | ✅ | — |
| Texto puro | `.txt` | ✅ | ✅ | — |
| PDF | `.pdf` | — | ✅ | Exportação (printToPDF) |

> ⚠️ O formato binário `.doc` (Word 97-2003) é obsoleto: o Prosa extrai o
> texto para leitura, mas a formatação rica não é preservada. Para editar,
> salve como `.docx` ou `.odt`. Formatos que não são documentos de texto
> (`.ods`, `.odp`, `.xlsx`, `.pptx`) não são abertos pelo Writer.

## ⌨️ Atalhos de teclado

| Ação | Atalho |
| --- | --- |
| Novo documento | `Ctrl+N` |
| Abrir | `Ctrl+O` |
| Salvar | `Ctrl+S` |
| Salvar como | `Ctrl+Shift+S` |
| Exportar PDF | `Ctrl+Shift+E` |
| Imprimir | `Ctrl+P` |
| Localizar | `Ctrl+F` |
| Substituir | `Ctrl+H` |
| Negrito | `Ctrl+B` |
| Itálico | `Ctrl+I` |
| Sublinhado | `Ctrl+U` |
| Título 1–6 | `Ctrl+Alt+1` … `Ctrl+Alt+6` |
| Ampliar / Reduzir / Restaurar zoom | `Ctrl++` / `Ctrl+-` / `Ctrl+0` |
| Alternar tópicos | `Ctrl+Shift+O` |
| Desfazer / Refazer | `Ctrl+Z` / `Ctrl+Y` |

> No macOS, use `Cmd` no lugar de `Ctrl`.

## 🚀 Como compilar e executar

### Pré-requisitos

- [Node.js](https://nodejs.org) 20 ou superior
- npm 10 ou superior

### Passos

```bash
# 1. Instalar dependências
npm install

# 2. Compilar (main, preload e renderer via esbuild)
npm run build

# 3. Executar a aplicação
npm start
```

### Scripts disponíveis

| Script | Descrição |
| --- | --- |
| `npm run build` | Compila os bundles para `dist/`. |
| `npm run build:watch` | Compila e observa alterações. |
| `npm start` | Compila e abre o Prosa. |
| `npm run typecheck` | Verificação de tipos com `tsc --noEmit`. |
| `npm test` | Executa os testes com `node:test` + `tsx`. |
| `npm run dist` | Gera os instaladores com `electron-builder`. |

## 🧪 Testes

Os testes usam o runner nativo do Node (`node:test`) e cobrem importação/exportação
de `.docx` e Markdown, além das utilidades de contagem e extração de tópicos.

```bash
npm test
```

## 🏗️ Estrutura do projeto

```
src/
├── main/         # Processo principal do Electron (janela, menus, IPC, arquivos)
├── renderer/     # Interface: editor TipTap, barra de ferramentas, painéis, páginas
└── shared/       # Tipos e utilidades compartilhadas entre os processos
tests/            # Testes unitários (node:test)
```

## 🤝 Contribuindo

Contribuições são bem-vindas! Para contribuir:

1. Faça um fork do repositório e crie um branch a partir de `main`.
2. Mantenha o **TypeScript em modo estrito** — sem `any` desnecessário.
3. Adicione o cabeçalho de licença em todo arquivo novo:
   ```ts
   // Prosa — Editor de Texto
   // Copyright (C) 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
   // SPDX-License-Identifier: GPL-3.0-or-later
   ```
4. Garanta que `npm run typecheck` e `npm test` passem.
5. Abra um Pull Request descrevendo a mudança.

O estilo de código segue o mesmo padrão do projeto
[Prisma4Postgres](https://github.com/britors/Prisma4Postgres).

## 📄 Licença

O Prosa é software livre, distribuído sob a licença
**GNU General Public License v3.0 ou posterior (GPL-3.0-or-later)**.

Este programa é distribuído na esperança de que seja útil, mas **SEM QUALQUER
GARANTIA**; sem mesmo a garantia implícita de COMERCIALIZAÇÃO ou ADEQUAÇÃO A UM
DETERMINADO FIM. Consulte a [GNU General Public License](LICENSE) para mais detalhes.

## 🏢 Sobre

Desenvolvido pela **W3TI SERVIÇOS DE INFORMÁTICA LTDA**.

- 🌐 Site: [w3ti.com.br](https://w3ti.com.br)
- 💻 GitHub: [github.com/w3ti/prosa](https://github.com/w3ti/prosa)
- ✉️ Suporte: [contato@w3ti.com.br](mailto:contato@w3ti.com.br)

© 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
