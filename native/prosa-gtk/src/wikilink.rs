//! Wikilinks `[[alvo]]` no editor.
//!
//! O editor Electron só cria a mark `wikilink` (`src/renderer/editor/extensions/wikilink.ts`)
//! via um diálogo explícito de link — nunca ao digitar. Aqui, em troca, o
//! texto tem uma única "superfície" (sem HTML rico por baixo), então o
//! caminho mais natural (estilo Obsidian) é detectar `[[Alvo]]` assim que o
//! usuário fecha os colchetes: eles somem e o texto restante vira a wikilink.
//!
//! Como não há suporte a alias (texto visível diferente do alvo), o texto
//! marcado *é* o alvo — o `href` da mark é sempre reconstruído a partir dele
//! (ver `formatting::text_node`), nunca guardado à parte.

use gtk::prelude::*;
use gtk::{TextBuffer, TextTag};
use regex::Regex;
use std::sync::OnceLock;

pub const WIKILINK_TAG: &str = "wikilink";

/// Cria e registra a tag visual da wikilink (estilo de link: cor + sublinhado).
pub fn setup_wikilink_tag(buffer: &TextBuffer) {
    let tag = TextTag::builder().name(WIKILINK_TAG).foreground("#1c71d8").underline(pango::Underline::Single).build();
    buffer.tag_table().add(&tag);
}

fn pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\[\[([^\[\]]+)\]\]").unwrap())
}

fn char_offset(text: &str, byte_offset: usize) -> i32 {
    text[..byte_offset].chars().count() as i32
}

/// Converte a primeira ocorrência de `[[alvo]]` do buffer (colchetes
/// literais, ainda não marcados) em texto simples + tag de wikilink.
/// Retorna `true` se converteu algo.
fn linkify_one(buffer: &TextBuffer) -> bool {
    let text = buffer.text(&buffer.start_iter(), &buffer.end_iter(), false).to_string();
    let Some(captures) = pattern().captures(&text) else { return false };
    let whole = captures.get(0).unwrap();
    let target = captures.get(1).unwrap().as_str().trim().to_string();
    if target.is_empty() {
        return false;
    }

    let match_start = char_offset(&text, whole.start());
    let match_end = char_offset(&text, whole.end());
    let cursor_offset = buffer.cursor_position();

    let mut start_iter = buffer.iter_at_offset(match_start);
    let mut end_iter = buffer.iter_at_offset(match_end);
    buffer.delete(&mut start_iter, &mut end_iter);
    buffer.insert(&mut start_iter, &target);

    let target_len = target.chars().count() as i32;
    if let Some(tag) = buffer.tag_table().lookup(WIKILINK_TAG) {
        let tag_start = buffer.iter_at_offset(match_start);
        let tag_end = buffer.iter_at_offset(match_start + target_len);
        buffer.apply_tag(&tag, &tag_start, &tag_end);
    }

    // Os colchetes removidos empurram tudo depois deles 4 posições pra trás;
    // se o cursor estava depois do trecho substituído, precisa acompanhar.
    let delta = (match_end - match_start) - target_len;
    if cursor_offset >= match_end {
        buffer.place_cursor(&buffer.iter_at_offset((cursor_offset - delta).max(0)));
    }
    true
}

/// Converte todas as ocorrências pendentes de `[[alvo]]` no buffer.
///
/// Chamado a cada `changed` do buffer (ver `main.rs`) — como cada conversão
/// mexe no próprio buffer, ela dispara `changed` de novo recursivamente, mas
/// cada nível só encontra o que sobrou depois da conversão anterior, então a
/// recursão termina (o total de colchetes só diminui).
pub fn linkify_pending(buffer: &TextBuffer) {
    while linkify_one(buffer) {}
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::formatting::doc_from_buffer;

    fn wikilink_run(doc: &prosa_doc::TipTapNode) -> Option<(&str, &str)> {
        let text_node = doc.content.as_ref()?[0].content.as_ref()?.iter().find(|node| {
            node.marks.as_ref().is_some_and(|marks| marks.iter().any(|m| m.kind == "wikilink"))
        })?;
        let href = text_node.marks.as_ref()?.iter().find(|m| m.kind == "wikilink")?.attrs.as_ref()?.get("href")?.as_str()?;
        Some((text_node.text.as_deref()?, href))
    }

    pub(crate) fn typing_closing_brackets_converts_to_wikilink() {
        let buffer = TextBuffer::new(None);
        setup_wikilink_tag(&buffer);
        buffer.set_text("veja [[Outro Documento]] por favor");

        linkify_pending(&buffer);

        assert_eq!(buffer.text(&buffer.start_iter(), &buffer.end_iter(), false), "veja Outro Documento por favor");
        let doc = doc_from_buffer(&buffer);
        let (text, href) = wikilink_run(&doc).expect("deve ter uma corrida marcada como wikilink");
        assert_eq!(text, "Outro Documento");
        assert_eq!(href, prosa_doc::wikilink::wiki_href("Outro Documento"));
    }

    pub(crate) fn converts_multiple_pending_links_in_one_pass() {
        let buffer = TextBuffer::new(None);
        setup_wikilink_tag(&buffer);
        buffer.set_text("[[A]] e [[B]]");

        linkify_pending(&buffer);

        assert_eq!(buffer.text(&buffer.start_iter(), &buffer.end_iter(), false), "A e B");
    }

    pub(crate) fn leaves_unclosed_brackets_untouched() {
        let buffer = TextBuffer::new(None);
        setup_wikilink_tag(&buffer);
        buffer.set_text("ainda digitando [[Alvo");

        linkify_pending(&buffer);

        assert_eq!(buffer.text(&buffer.start_iter(), &buffer.end_iter(), false), "ainda digitando [[Alvo");
    }

    pub(crate) fn cursor_after_match_shifts_back_by_removed_brackets() {
        let buffer = TextBuffer::new(None);
        setup_wikilink_tag(&buffer);
        buffer.set_text("[[Alvo]] resto");
        buffer.place_cursor(&buffer.end_iter());

        linkify_pending(&buffer);

        let cursor = buffer.cursor_position();
        assert_eq!(buffer.iter_at_offset(cursor), buffer.end_iter(), "cursor deve continuar no fim do texto");
    }
}
