//! Ponte entre `GtkTextTag` (formatação inline/de bloco no `GtkTextBuffer`)
//! e o modelo de documento (`prosa_doc::TipTapNode`).
//!
//! Marks inline cobrem negrito/itálico/sublinhado/tachado — a mesma base de
//! `StarterKit`/`Underline` usada pela versão Electron (`src/renderer/editor/editor.ts`),
//! com os mesmos nomes de tipo de mark (`bold`, `italic`, `underline`, `strike`),
//! para que os arquivos `.prosa` continuem compatíveis entre as duas versões.
//!
//! Títulos (H1-H3, os únicos que a toolbar do Electron também expõe) são
//! uma tag de **linha inteira** (não uma mark inline): `prosa-heading-N`,
//! mutuamente exclusivas entre si, com tamanho/peso de fonte maiores.
//! Níveis 4-6 vindos de um arquivo existente são achatados pro nível 3
//! (mesmo padrão "melhor esforço" do resto do MVP). Tabelas, imagens,
//! listas continuam fora de escopo.

use gtk::prelude::*;
use gtk::{TextBuffer, TextIter, TextTag};
use prosa_doc::wikilink::wiki_href;
use prosa_doc::{Mark, TipTapNode};

use crate::citation;
use crate::wikilink::WIKILINK_TAG;

/// Nomes de mark suportados, iguais aos tipos registrados no editor Electron.
pub const MARK_NAMES: [&str; 6] = ["bold", "italic", "underline", "strike", "superscript", "subscript"];

/// Nomes das tags de título, na ordem do nível (índice 0 = nível 1).
pub const HEADING_TAG_NAMES: [&str; 3] = ["prosa-heading-1", "prosa-heading-2", "prosa-heading-3"];

/// Escapa texto para uso dentro de Pango markup (`set_markup`).
fn escape_markup(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn markup_for_node(node: &TipTapNode, out: &mut String) {
    if let Some(text) = &node.text {
        let mut open = String::new();
        let mut close = String::new();
        if let Some(marks) = &node.marks {
            for mark in marks {
                match mark.kind.as_str() {
                    "bold" => {
                        open.push_str("<b>");
                        close.insert_str(0, "</b>");
                    }
                    "italic" => {
                        open.push_str("<i>");
                        close.insert_str(0, "</i>");
                    }
                    "underline" => {
                        open.push_str("<u>");
                        close.insert_str(0, "</u>");
                    }
                    "strike" => {
                        open.push_str("<s>");
                        close.insert_str(0, "</s>");
                    }
                    // Pango markup não tem `<sup>`/`<sub>` garantidos em
                    // todas as versões — `<span rise=... size=...>` é o
                    // equivalente universal.
                    "superscript" => {
                        open.push_str(r#"<span rise="6000" size="70%">"#);
                        close.insert_str(0, "</span>");
                    }
                    "subscript" => {
                        open.push_str(r#"<span rise="-6000" size="70%">"#);
                        close.insert_str(0, "</span>");
                    }
                    _ => {}
                }
            }
        }
        out.push_str(&open);
        out.push_str(&escape_markup(text));
        out.push_str(&close);
    }
    if let Some(children) = &node.content {
        for child in children {
            markup_for_node(child, out);
        }
    }
}

/// Constrói Pango markup (`<b>`/`<i>`/`<u>`/`<s>`) a partir do `doc` TipTap,
/// uma linha por bloco de nível superior — usado na exportação para PDF.
pub fn markup_from_doc(doc: &TipTapNode) -> String {
    let mut out = String::new();
    if let Some(blocks) = &doc.content {
        for (index, block) in blocks.iter().enumerate() {
            if index > 0 {
                out.push('\n');
            }
            markup_for_node(block, &mut out);
        }
    }
    out
}

/// Cria e registra na tag table do buffer uma `GtkTextTag` para cada mark suportada.
pub fn setup_mark_tags(buffer: &TextBuffer) {
    let bold = TextTag::builder()
        .name("bold")
        .weight(700) // PANGO_WEIGHT_BOLD
        .build();
    let italic = TextTag::builder().name("italic").style(pango::Style::Italic).build();
    let underline = TextTag::builder()
        .name("underline")
        .underline(pango::Underline::Single)
        .build();
    let strike = TextTag::builder().name("strike").strikethrough(true).build();
    // Sem suporte nativo real a sobrescrito/subscrito no GtkTextView —
    // simulado com deslocamento vertical (`rise`) + fonte menor (`scale`).
    let superscript = TextTag::builder().name("superscript").rise(6000).scale(0.7).build();
    let subscript = TextTag::builder().name("subscript").rise(-6000).scale(0.7).build();

    let table = buffer.tag_table();
    table.add(&bold);
    table.add(&italic);
    table.add(&underline);
    table.add(&strike);
    table.add(&superscript);
    table.add(&subscript);
}

/// Cria e registra as três tags de título (H1-H3), maiores e em negrito.
pub fn setup_heading_tags(buffer: &TextBuffer) {
    let table = buffer.tag_table();
    for (name, scale) in HEADING_TAG_NAMES.iter().zip([1.8, 1.5, 1.25]) {
        let tag = TextTag::builder().name(*name).scale(scale).weight(700).build();
        table.add(&tag);
    }
}

/// Início/fim (iterators) da linha `line`, sem usar `forward_to_line_end`
/// (com linhas vazias adjacentes a outro `\n`, seu comportamento pula a
/// linha vazia inteira — bug real já pego uma vez na paginação ao vivo).
pub(crate) fn line_range(buffer: &TextBuffer, line: i32) -> (TextIter, TextIter) {
    let start = buffer.iter_at_line(line).expect("linha válida");
    let end = if line + 1 < buffer.line_count() {
        let mut next_start = buffer.iter_at_line(line + 1).expect("próxima linha válida");
        next_start.backward_char();
        next_start
    } else {
        buffer.end_iter()
    };
    (start, end)
}

/// Nível de título (1-3) aplicado à linha, se houver.
pub fn heading_level_at_line(buffer: &TextBuffer, line: i32) -> Option<u8> {
    let Some(start) = buffer.iter_at_line(line) else { return None };
    let table = buffer.tag_table();
    HEADING_TAG_NAMES.iter().position(|name| table.lookup(name).is_some_and(|tag| start.has_tag(&tag))).map(|index| (index + 1) as u8)
}

/// Define (ou remove, se `level` for `None`) o título da linha inteira.
/// Uma linha vazia não tem nenhum caractere pra prender a tag — nesse caso
/// a linha simplesmente não retém o título (mesma limitação de qualquer
/// abordagem baseada em tag presa a conteúdo real).
pub fn set_heading_level(buffer: &TextBuffer, line: i32, level: Option<u8>) {
    let (start, end) = line_range(buffer, line);
    let table = buffer.tag_table();
    for name in HEADING_TAG_NAMES {
        if let Some(tag) = table.lookup(name) {
            buffer.remove_tag(&tag, &start, &end);
        }
    }
    if let Some(level) = level {
        if let Some(name) = HEADING_TAG_NAMES.get((level as usize).saturating_sub(1)) {
            if let Some(tag) = table.lookup(name) {
                buffer.apply_tag(&tag, &start, &end);
            }
        }
    }
}

/// Linha onde está o cursor — usado pelos botões de título da toolbar.
pub fn current_line(buffer: &TextBuffer) -> i32 {
    buffer.iter_at_offset(buffer.cursor_position()).line()
}

/// Alterna uma mark sobre a seleção atual: aplica se algum trecho selecionado
/// não tiver a tag, remove se a seleção inteira já estiver marcada.
pub fn toggle_mark(buffer: &TextBuffer, mark_name: &str) {
    let Some((start, end)) = buffer.selection_bounds() else { return };
    let Some(tag) = buffer.tag_table().lookup(mark_name) else { return };

    if range_fully_tagged(&start, &end, &tag) {
        buffer.remove_tag(&tag, &start, &end);
    } else {
        buffer.apply_tag(&tag, &start, &end);
    }
}

fn range_fully_tagged(start: &TextIter, end: &TextIter, tag: &TextTag) -> bool {
    let mut iter = start.clone();
    while &iter < end {
        if !iter.has_tag(tag) {
            return false;
        }
        if !iter.forward_char() {
            break;
        }
    }
    true
}

fn active_mark_names(iter: &TextIter) -> Vec<String> {
    let mut names: Vec<String> = iter
        .tags()
        .iter()
        .filter_map(|tag| tag.name().map(|n| n.to_string()))
        .filter(|name| MARK_NAMES.contains(&name.as_str()) || name == WIKILINK_TAG || name.starts_with(citation::TAG_PREFIX))
        .collect();
    names.sort();
    names
}

/// Constrói a mark de cada nome ativo sobre `text`. A wikilink não tem
/// alias/texto-visível separado do alvo (ver `wikilink.rs`) — o `href` é
/// sempre recalculado a partir do próprio texto marcado. A citação é o
/// oposto: o texto visível é livre, então a `citeKey` vem do próprio nome
/// da tag (`citation:<citeKey>`, ver `citation.rs`), não do texto.
fn text_node(text: &str, mark_names: &[String]) -> TipTapNode {
    let marks = if mark_names.is_empty() {
        None
    } else {
        Some(
            mark_names
                .iter()
                .map(|name| {
                    if name == WIKILINK_TAG {
                        Mark { kind: WIKILINK_TAG.to_string(), attrs: Some(serde_json::json!({ "href": wiki_href(text) })) }
                    } else if let Some(cite_key) = citation::cite_key_from_tag_name(name) {
                        Mark { kind: "citation".to_string(), attrs: Some(serde_json::json!({ "citeKey": cite_key })) }
                    } else {
                        Mark { kind: name.clone(), attrs: None }
                    }
                })
                .collect(),
        )
    };
    TipTapNode {
        kind: "text".to_string(),
        text: Some(text.to_string()),
        marks,
        ..Default::default()
    }
}

/// Constrói o nó `paragraph`/`heading` de uma linha do buffer, dividindo-a
/// em corridas de texto conforme os grupos de marks ativas mudam.
fn paragraph_from_line(buffer: &TextBuffer, line: i32) -> TipTapNode {
    let (start, end) = line_range(buffer, line);
    let level = heading_level_at_line(buffer, line);
    let kind = if level.is_some() { "heading" } else { "paragraph" }.to_string();
    let attrs = level.map(|l| serde_json::json!({ "level": l }));

    if start == end {
        return TipTapNode { kind, attrs, ..Default::default() };
    }

    let mut runs = Vec::new();
    let mut run_start = start.clone();
    let mut run_marks = active_mark_names(&run_start);
    let mut cursor = start.clone();

    loop {
        let reached_end = !cursor.forward_char() || cursor >= end;
        let now_marks = if reached_end { Vec::new() } else { active_mark_names(&cursor) };
        if reached_end || now_marks != run_marks {
            let boundary = if reached_end { end.clone() } else { cursor.clone() };
            let text = buffer.text(&run_start, &boundary, false).to_string();
            if !text.is_empty() {
                runs.push(text_node(&text, &run_marks));
            }
            if reached_end {
                break;
            }
            run_start = cursor.clone();
            run_marks = now_marks;
        }
    }

    TipTapNode { kind, attrs, content: Some(runs), ..Default::default() }
}

/// Constrói um `doc` TipTap a partir do conteúdo inteiro do buffer, uma linha
/// por parágrafo, preservando negrito/itálico/sublinhado/tachado.
pub fn doc_from_buffer(buffer: &TextBuffer) -> TipTapNode {
    let line_count = buffer.line_count();
    let paragraphs: Vec<TipTapNode> = (0..line_count).map(|line| paragraph_from_line(buffer, line)).collect();
    TipTapNode {
        kind: "doc".to_string(),
        content: Some(paragraphs),
        ..Default::default()
    }
}

/// Insere um nó (e seus filhos) no fim do buffer, aplicando as tags
/// correspondentes às marks de cada trecho de texto encontrado.
fn insert_node(buffer: &TextBuffer, node: &TipTapNode) {
    if let Some(text) = &node.text {
        let start_offset = buffer.end_iter().offset();
        let mut end_iter = buffer.end_iter();
        buffer.insert(&mut end_iter, text);

        if let Some(marks) = &node.marks {
            let start = buffer.iter_at_offset(start_offset);
            let end = buffer.end_iter();
            for mark in marks {
                let tag = if mark.kind == "citation" {
                    mark.attrs
                        .as_ref()
                        .and_then(|attrs| attrs.get("citeKey"))
                        .and_then(|v| v.as_str())
                        .map(|cite_key| citation::citation_tag(buffer, cite_key))
                } else {
                    buffer.tag_table().lookup(&mark.kind)
                };
                if let Some(tag) = tag {
                    buffer.apply_tag(&tag, &start, &end);
                }
            }
        }
    }

    if let Some(children) = &node.content {
        for child in children {
            insert_node(buffer, child);
        }
    }
}

/// Carrega um `doc` TipTap no buffer, um bloco de nível superior por linha,
/// reaplicando as marks suportadas e o título (H1-H3; níveis 4-6 são
/// achatados pro nível 3).
pub fn load_doc_into_buffer(buffer: &TextBuffer, doc: &TipTapNode) {
    buffer.set_text("");
    if let Some(blocks) = &doc.content {
        for (index, block) in blocks.iter().enumerate() {
            if index > 0 {
                let mut end_iter = buffer.end_iter();
                buffer.insert(&mut end_iter, "\n");
            }
            insert_node(buffer, block);
            if block.kind == "heading" {
                let level = block.attrs.as_ref().and_then(|attrs| attrs.get("level")).and_then(|v| v.as_u64()).unwrap_or(1);
                set_heading_level(buffer, index as i32, Some(level.clamp(1, 3) as u8));
            }
        }
    }
}

/// Testes que tocam GTK real (`GtkTextBuffer`). Não têm `#[test]` próprio:
/// GTK só aceita ser inicializado numa única thread do processo, e o harness
/// padrão do Rust roda cada `#[test]` em sua própria thread — por isso todos
/// os testes que dependem de GTK, de qualquer módulo, são chamados a partir
/// de um único `#[test]` central em `tests.rs`.
#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn first_run_marks(doc: &TipTapNode) -> Vec<String> {
        doc.content.as_ref().unwrap()[0]
            .content
            .as_ref()
            .unwrap()[0]
            .marks
            .as_ref()
            .map(|marks| marks.iter().map(|m| m.kind.clone()).collect())
            .unwrap_or_default()
    }

    pub(crate) fn toggle_mark_applies_and_removes() {
        let buffer = TextBuffer::new(None);
        setup_mark_tags(&buffer);
        buffer.set_text("palavra simples");

        buffer.select_range(&buffer.iter_at_offset(0), &buffer.iter_at_offset(7)); // "palavra"
        toggle_mark(&buffer, "bold");
        let doc = doc_from_buffer(&buffer);
        assert_eq!(
            first_run_marks(&doc),
            vec!["bold".to_string()],
            "primeira aplicação deve marcar em negrito"
        );

        buffer.select_range(&buffer.iter_at_offset(0), &buffer.iter_at_offset(7));
        toggle_mark(&buffer, "bold");
        let doc = doc_from_buffer(&buffer);
        assert!(
            first_run_marks(&doc).is_empty(),
            "segunda aplicação sobre o mesmo trecho deve remover a marca"
        );
    }

    pub(crate) fn round_trip_preserves_marks() {
        let buffer = TextBuffer::new(None);
        setup_mark_tags(&buffer);

        let original = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "paragraph".to_string(),
                content: Some(vec![
                    text_node("Olá ", &[]),
                    text_node("mundo", &["bold".to_string()]),
                    text_node(" em ", &[]),
                    text_node("itálico", &["italic".to_string(), "underline".to_string()]),
                ]),
                ..Default::default()
            }]),
            ..Default::default()
        };

        load_doc_into_buffer(&buffer, &original);
        let rebuilt = doc_from_buffer(&buffer);

        assert_eq!(rebuilt, original);
    }

    pub(crate) fn multiple_paragraphs_round_trip() {
        let buffer = TextBuffer::new(None);
        setup_mark_tags(&buffer);

        let original = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![
                TipTapNode {
                    kind: "paragraph".to_string(),
                    content: Some(vec![text_node("primeira", &["bold".to_string()])]),
                    ..Default::default()
                },
                TipTapNode { kind: "paragraph".to_string(), ..Default::default() },
                TipTapNode {
                    kind: "paragraph".to_string(),
                    content: Some(vec![text_node("terceira", &[])]),
                    ..Default::default()
                },
            ]),
            ..Default::default()
        };

        load_doc_into_buffer(&buffer, &original);
        let rebuilt = doc_from_buffer(&buffer);
        assert_eq!(rebuilt, original);
    }

    pub(crate) fn heading_round_trips_with_level() {
        let buffer = TextBuffer::new(None);
        setup_mark_tags(&buffer);
        setup_heading_tags(&buffer);

        let original = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![
                TipTapNode {
                    kind: "heading".to_string(),
                    attrs: Some(serde_json::json!({ "level": 2 })),
                    content: Some(vec![text_node("Título da seção", &["bold".to_string()])]),
                    ..Default::default()
                },
                TipTapNode {
                    kind: "paragraph".to_string(),
                    content: Some(vec![text_node("parágrafo normal", &[])]),
                    ..Default::default()
                },
            ]),
            ..Default::default()
        };

        load_doc_into_buffer(&buffer, &original);
        assert_eq!(heading_level_at_line(&buffer, 0), Some(2), "primeira linha deve ficar marcada como título nível 2");
        assert_eq!(heading_level_at_line(&buffer, 1), None, "segunda linha é parágrafo normal, sem título");

        let rebuilt = doc_from_buffer(&buffer);
        assert_eq!(rebuilt, original);
    }

    pub(crate) fn heading_levels_above_three_are_clamped_down() {
        let buffer = TextBuffer::new(None);
        setup_heading_tags(&buffer);
        let doc = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "heading".to_string(),
                attrs: Some(serde_json::json!({ "level": 5 })),
                content: Some(vec![text_node("título nível 5", &[])]),
                ..Default::default()
            }]),
            ..Default::default()
        };
        load_doc_into_buffer(&buffer, &doc);
        assert_eq!(heading_level_at_line(&buffer, 0), Some(3), "nível acima de 3 deve ser achatado pro nível 3");
    }

    pub(crate) fn set_heading_level_toggles_between_paragraph_and_heading() {
        let buffer = TextBuffer::new(None);
        setup_heading_tags(&buffer);
        buffer.set_text("uma linha de texto");

        set_heading_level(&buffer, 0, Some(1));
        assert_eq!(heading_level_at_line(&buffer, 0), Some(1));

        set_heading_level(&buffer, 0, Some(3));
        assert_eq!(heading_level_at_line(&buffer, 0), Some(3), "deve trocar de nível, não acumular tags");

        set_heading_level(&buffer, 0, None);
        assert_eq!(heading_level_at_line(&buffer, 0), None, "deve voltar a parágrafo normal");
    }
}
