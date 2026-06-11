#!/bin/bash
issues=(
  "Feature: Motor de Temas Dinâmicos | Implementar suporte a paletas de cores customizadas pelo usuário."
  "Feature: Transições Fluidas | Implementar transições suaves (fade, slide) ao trocar abas e abrir painéis."
  "Feature: Tipografia Adaptativa | Ajuste automático de entrelinha, largura e contraste conforme a janela."
  "Feature: Interface Modular | Permitir que o usuário arraste e reordene painéis (outline, estilos, etc)."
  "Feature: Ícones Customizados | Implementar um novo set de ícones mais coeso e elegante."
  "Feature: Typewriter Mode | O cursor permanece centralizado enquanto o documento rola ao digitar."
  "Feature: Ghost Text (IA Autocomplete) | Sugestões de continuação de frase em tempo real."
  "Feature: Estatísticas de Foco | Dashboard de tempo de sessão, ritmo de escrita (WPM) e metas."
  "Feature: Integração Gramatical Nativa | Correção gramatical em tempo real (ex: LanguageTool)."
  "Feature: Modo de Leitura Dedicado | Alternar para visualização interativa protegida contra edição."
  "Feature: Wikilinks e Backlinks | Sistema de referência [[Link]] e mapeamento de conexões."
  "Feature: Visualização em Grafo | Mapa visual das conexões entre documentos."
  "Feature: Daily Notes | Automação para criar/abrir documentos diários."
  "Feature: Gerenciador de Workspaces | Alternar entre pastas raiz de projetos com estados salvos."
  "Feature: Tags e Metadados Inteligentes | Barra lateral para gerenciar metadados visíveis."
  "Feature: Command Palette | Acesso rápido a todas as funções via Ctrl+P."
  "Feature: Quick Switcher | Alternância rápida entre arquivos abertos via busca."
  "Feature: Gestão de Citações (BibTeX) | Integração com Zotero/BibTeX para referências."
  "Feature: Snapshot de Versão Local | Histórico local para restauração automática de versões."
  "Feature: Exportação Avançada (Epub/LaTeX) | Suporte a formatos profissionais de publicação."
)

for issue in "${issues[@]}"; do
  IFS="|" read -r title body <<< "$issue"
  gh issue create --title "$title" --body "$body"
done
