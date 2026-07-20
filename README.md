# Prosa

## Escreva. Formate. Publique

**Editor de texto nativo, open source e em modo escuro — parte da suíte de escritório Rodrigo Brito.**

[![Licença: GPL v3](https://img.shields.io/badge/Licen%C3%A7a-GPLv3-06B6D4.svg)](LICENSE)
![Rust](https://img.shields.io/badge/Rust-2021-06B6D4.svg)
![GTK4](https://img.shields.io/badge/GTK4%20%2B%20libadwaita-0891B2.svg)

---

O **Prosa** é um processador de texto desktop nativo para Linux/GNOME,
construído em **Rust** sobre **GTK4** e **libadwaita** — leve, integrado ao
tema do sistema e sem a pegada de memória de uma casca Electron. Compete com
o LibreOffice Writer e o Microsoft Word, mas com a leveza e a estética de um
editor atual.

> O Prosa começou como um app Electron/TypeScript e foi reescrito do zero em
> Rust nativo. A versão Electron foi descontinuada e removida deste
> repositório; o histórico completo dela continua disponível no `git log`.

## ✨ Funcionalidades

- 📝 **Edição rica** — títulos (H1–H3), negrito, itálico, sublinhado,
  tachado, sobrescrito, subscrito, alinhamento de parágrafo (esquerda,
  centro, direita, justificado) e família/tamanho de fonte (com busca entre
  as fontes instaladas no sistema).
- 📐 **Página A4 simulada** — área de edição com margens reais e indicador
  de quebra de página ao vivo.
- 📑 **Painel de tópicos** — outline automático dos títulos do documento,
  com navegação por clique.
- 🔗 **Wikilinks, backlinks e grafo** — `[[Link]]` entre documentos de um
  workspace, painel de referências e visualização em grafo das conexões.
- 📚 **Citações e bibliografia** — importação de `.bib` (BibTeX), estilos
  ABNT/APA/IEEE, inserção de citações e lista de referências.
- 🕓 **Histórico de versões** — backup automático a cada salvamento, diff
  contra o documento atual e restauração de uma versão anterior.
- 🔄 **Sincronização** — observa uma pasta de sincronização externa
  (Dropbox, Drive, etc.) e avisa quando o documento aberto muda por fora do
  Prosa.
- 🗂️ **Modelos de documento** — Artigo, Relatório, Contrato, Ata, Proposta
  comercial e Capítulo de livro, prontos no comando "Novo documento".
- 🔍 **Localizar & Substituir** — com diferenciação de maiúsculas, palavra
  inteira e expressões regulares.
- ✅ **Corretor ortográfico** — sublinha palavras erradas (pt-BR e en-US) e,
  com o botão direito, mostra sugestões de correção.
- 🖨️ **Exportação em PDF** — paginação real via GtkPrintOperation/Pango.
- 🤖 **IA assistida** — suporte a OpenAI, Gemini, Claude, Mistral, Groq e
  Cohere para revisar, resumir, expandir, traduzir e reorganizar textos.
- 📥📤 **Importação e exportação** — `.docx` (Word), `.odt`
  (LibreOffice/OpenDocument) e `.rtf`, verificados contra o LibreOffice real.
- 💾 **Formato nativo `.prosa`** — JSON com o documento e metadados,
  compatível com o formato usado pela versão Electron original.
- 🌙 **Modo claro/escuro** — segue o tema do sistema via libadwaita.

## 📁 Compatibilidade de formatos

| Formato | Extensão | Abrir | Salvar | Origem |
| --- | --- | :---: | :---: | --- |
| Prosa (nativo) | `.prosa` | ✅ | ✅ | JSON (documento + metadados) |
| Word | `.docx` | ✅ | ✅ | Microsoft Office |
| OpenDocument Text | `.odt` | ✅ | ✅ | LibreOffice / OpenOffice |
| Rich Text | `.rtf` | ✅ | ✅ | Word e LibreOffice |
| PDF | `.pdf` | — | ✅ | Exportação |

> Sobrescrito/subscrito ainda não são preservados na exportação para
> `.docx`/`.odt`/`.rtf` (o texto sobrevive, a formatação some) — extensão
> planejada, não implementada ainda.

## ⌨️ Atalhos de teclado

| Ação | Atalho |
| --- | --- |
| Localizar / Substituir | `Ctrl+F` |
| Negrito | `Ctrl+B` |
| Itálico | `Ctrl+I` |
| Sublinhado | `Ctrl+U` |

> Cobertura de atalhos ainda parcial — a maioria das ações (salvar, abrir,
> títulos, alinhamento, etc.) por enquanto só está na barra de ferramentas.

## 📦 Instalação

Pacotes pré-compilados são publicados a cada release em
[github.com/britors/Prosa/releases](https://github.com/britors/Prosa/releases)
(`.deb`, `.rpm` e um `.zip` portátil pro Windows).

**Linux — via gerenciador de pacotes (requer sudo)**, cobre Ubuntu/Debian
(`.deb`), Fedora e openSUSE Leap (`.rpm`):

```sh
curl -fsSL https://raw.githubusercontent.com/britors/Prosa/main/scripts/install.sh | sudo bash
```

**Linux — sem sudo, só pro usuário atual**, extrai o pacote da release e
instala em `~/.local` (bibliotecas de sistema como GTK4/libadwaita/enchant2
continuam sendo necessárias — o script avisa se alguma estiver faltando):

```sh
curl -fsSL https://raw.githubusercontent.com/britors/Prosa/main/scripts/install-user.sh | bash
```

**Windows**: baixe `prosa-windows-x86_64.zip` na página de
[releases](https://github.com/britors/Prosa/releases/latest) e extraia em
qualquer pasta — é portátil, não precisa de instalador. Rode
`bin\prosa.exe`.

## 🚀 Como compilar e executar

### Pré-requisitos

- [Rust](https://rustup.rs) (edição 2021 ou mais recente)
- GTK4 e libadwaita (>= 1.5) com cabeçalhos de desenvolvimento
- Pango, Cairo e `enchant` (corretor ortográfico) com cabeçalhos de
  desenvolvimento
- Dicionários de corretor ortográfico (`myspell-pt_BR`/`myspell-en_US` ou
  equivalentes da distro)

Em openSUSE:

```sh
sudo zypper install gtk4-devel libadwaita-devel enchant-devel \
  myspell-pt_BR myspell-en_US
```

Em Fedora (44 ou mais recente):

```sh
sudo dnf install gtk4-devel libadwaita-devel pango-devel cairo-devel \
  enchant2-devel hunspell-pt-BR hunspell-en-US
```

### Passos

```bash
cd native

# Compilar (debug)
cargo build

# Ou compilar otimizado
cargo build --release

# Executar
./target/debug/prosa      # ou target/release/prosa
```

### Testes

```bash
cd native
cargo test --workspace
```

## 🏗️ Estrutura do projeto

```bash
native/
├── prosa-doc/    # Modelo de documento, conversão de formatos, IA, histórico
│                 # de versões, sincronização — sem dependência de GTK
└── prosa-gtk/    # Casca GTK4 + libadwaita (binário `prosa`)
```

## 🤝 Contribuindo

Contribuições são bem-vindas! Para contribuir:

1. Faça um fork do repositório e crie um branch a partir de `main`.
2. Rode `cargo fmt` e `cargo test --workspace` antes de abrir o PR.
3. Adicione o cabeçalho de licença em todo arquivo novo:

   ```rust
   // Prosa — Editor de Texto
   // Copyright (C) 2026 Rodrigo Brito
   // SPDX-License-Identifier: GPL-3.0-or-later
   ```

4. Abra um Pull Request descrevendo a mudança.

## 📄 Licença

O Prosa é software livre, distribuído sob a licença
**GNU General Public License v3.0 ou posterior (GPL-3.0-or-later)**.

Este programa é distribuído na esperança de que seja útil, mas **SEM QUALQUER
GARANTIA**; sem mesmo a garantia implícita de COMERCIALIZAÇÃO ou ADEQUAÇÃO A UM
DETERMINADO FIM. Consulte a [GNU General Public License](LICENSE) para mais detalhes.

## 🏢 Sobre

Desenvolvido pela **Rodrigo Brito**.

- 💻 GitHub: [github.com/britors/prosa](https://github.com/britors/prosa)
- ✉️ Suporte: [rodrigo@w3ti.com.br](mailto:rodrigo@w3ti.com.br)

© 2026 Rodrigo Brito
