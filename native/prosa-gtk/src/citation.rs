//! Marca de citação (`[@citeKey]` no BibTeX/Electron) no editor.
//!
//! Diferente da wikilink (`wikilink.rs`, onde o texto marcado *é* o alvo),
//! aqui o texto visível ("(Silva, 2024)") é independente da `citeKey`
//! ("silva2024") — a mark carrega esse atributo à parte. Uma `GtkTextTag`
//! não tem como guardar um atributo arbitrário por instância além do nome,
//! então cada `citeKey` ganha sua própria tag, nomeada `citation:<citeKey>`,
//! criada sob demanda e usada tanto pra aplicar a marca quanto (no
//! round-trip buffer -> doc, ver `formatting.rs`) pra reconstruir qual
//! `citeKey` cada trecho carrega.

use gtk::prelude::*;
use gtk::{TextBuffer, TextTag};

pub const TAG_PREFIX: &str = "citation:";

/// Acha (ou cria e registra na tag table do buffer) a tag de citação de
/// `cite_key`. Idempotente: chamadas repetidas com a mesma chave retornam a
/// mesma tag.
pub fn citation_tag(buffer: &TextBuffer, cite_key: &str) -> TextTag {
    let name = format!("{TAG_PREFIX}{cite_key}");
    let table = buffer.tag_table();
    if let Some(tag) = table.lookup(&name) {
        return tag;
    }
    let tag = TextTag::builder().name(&name).foreground("#c9791c").style(pango::Style::Italic).build();
    table.add(&tag);
    tag
}

/// `citeKey` de uma tag de citação, a partir do nome (`citation:<citeKey>`).
/// `None` se `name` não tiver o prefixo (não é uma tag de citação).
pub fn cite_key_from_tag_name(name: &str) -> Option<&str> {
    name.strip_prefix(TAG_PREFIX)
}

/// Aplica a marca de citação sobre a seleção atual do buffer.
pub fn apply_citation(buffer: &TextBuffer, cite_key: &str) {
    let Some((start, end)) = buffer.selection_bounds() else { return };
    let tag = citation_tag(buffer, cite_key);
    buffer.apply_tag(&tag, &start, &end);
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::formatting::doc_from_buffer;

    pub(crate) fn citation_tag_is_created_once_and_reused() {
        let buffer = TextBuffer::new(None);
        buffer.set_text("texto");
        let first = citation_tag(&buffer, "silva2024");
        let second = citation_tag(&buffer, "silva2024");
        assert_eq!(first, second, "mesma citeKey deve reusar a mesma tag, não criar duplicada");
    }

    pub(crate) fn cite_key_from_tag_name_extracts_or_rejects() {
        assert_eq!(cite_key_from_tag_name("citation:silva2024"), Some("silva2024"));
        assert_eq!(cite_key_from_tag_name("bold"), None);
    }

    pub(crate) fn apply_citation_round_trips_with_display_text_different_from_key() {
        let buffer = TextBuffer::new(None);
        buffer.set_text("veja (Silva, 2024) para mais");
        buffer.select_range(&buffer.iter_at_offset(5), &buffer.iter_at_offset(18)); // "(Silva, 2024)"
        apply_citation(&buffer, "silva2024");

        let doc = doc_from_buffer(&buffer);
        let run = doc.content.as_ref().unwrap()[0]
            .content
            .as_ref()
            .unwrap()
            .iter()
            .find(|node| node.marks.as_ref().is_some_and(|marks| marks.iter().any(|m| m.kind == "citation")))
            .expect("deve ter uma corrida marcada como citação");

        assert_eq!(run.text.as_deref(), Some("(Silva, 2024)"), "texto visível continua livre, diferente da chave");
        let cite_key = run.marks.as_ref().unwrap().iter().find(|m| m.kind == "citation").unwrap().attrs.as_ref().unwrap().get("citeKey").unwrap().as_str().unwrap();
        assert_eq!(cite_key, "silva2024");
    }
}
