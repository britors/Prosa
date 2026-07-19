//! Família e tamanho de fonte no editor.
//!
//! No Electron (`src/renderer/editor/editor.ts`), `FontFamily` e `FontSize`
//! são duas extensões TipTap que escrevem no *mesmo* tipo de mark
//! `textStyle` (de `@tiptap/extension-text-style`), cada uma cuidando de um
//! atributo (`fontFamily`/`fontSize`) — um trecho de texto tem no máximo
//! uma mark `textStyle`, com um ou os dois atributos presentes. `fontSize`
//! é serializado como string com sufixo `"pt"` (ex.: `"14pt"`), não número
//! puro — mantido assim aqui pra continuar compatível com `.prosa`
//! existentes.
//!
//! Igual à citação (`citation.rs`): uma `GtkTextTag` não guarda um atributo
//! arbitrário por instância além do nome, então família e tamanho ganham
//! cada um sua própria tag sob demanda (`font-family:<nome>`,
//! `font-size:<n>`), e o round-trip buffer -> doc (`formatting.rs`) as
//! recombina numa única mark `textStyle`.

use gtk::prelude::*;
use gtk::{TextBuffer, TextIter, TextTag, TextTagTable};

pub const FAMILY_PREFIX: &str = "font-family:";
pub const SIZE_PREFIX: &str = "font-size:";

/// Tamanhos oferecidos no seletor da toolbar — mesma lista do original
/// (`FONT_SIZES` em `src/renderer/editor/toolbar.ts`).
pub const FONT_SIZES: [u32; 15] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

/// Acha (ou cria e registra) a tag de família `family`. Idempotente.
pub fn family_tag(buffer: &TextBuffer, family: &str) -> TextTag {
    let name = format!("{FAMILY_PREFIX}{family}");
    let table = buffer.tag_table();
    if let Some(tag) = table.lookup(&name) {
        return tag;
    }
    let tag = TextTag::builder().name(&name).family(family).build();
    table.add(&tag);
    tag
}

/// Acha (ou cria e registra) a tag de tamanho `size_pt` (só o número, sem
/// `"pt"`). Idempotente.
pub fn size_tag(buffer: &TextBuffer, size_pt: &str) -> TextTag {
    let name = format!("{SIZE_PREFIX}{size_pt}");
    let table = buffer.tag_table();
    if let Some(tag) = table.lookup(&name) {
        return tag;
    }
    let points: f64 = size_pt.parse().unwrap_or(12.0);
    let tag = TextTag::builder().name(&name).size_points(points).build();
    table.add(&tag);
    tag
}

/// Família a partir do nome da tag (`font-family:<nome>`).
pub fn family_from_tag_name(name: &str) -> Option<&str> {
    name.strip_prefix(FAMILY_PREFIX)
}

/// Tamanho (só o número) a partir do nome da tag (`font-size:<n>`).
pub fn size_from_tag_name(name: &str) -> Option<&str> {
    name.strip_prefix(SIZE_PREFIX)
}

/// Remove da faixa qualquer tag cujo nome comece com `prefix` — família e
/// tamanho são cada um mutuamente exclusivos entre si (várias famílias
/// nunca ficam sobrepostas na mesma faixa), mas independentes um do outro,
/// mesma relação que título tem com alinhamento em `formatting.rs`. As tags
/// são dinâmicas (uma por família/tamanho já usado no documento, não uma
/// lista fixa como `HEADING_TAG_NAMES`), por isso precisa varrer a tag
/// table inteira em vez de iterar uma constante.
fn remove_tags_with_prefix(buffer: &TextBuffer, table: &TextTagTable, start: &TextIter, end: &TextIter, prefix: &str) {
    let mut to_remove = Vec::new();
    table.foreach(|tag| {
        if tag.name().is_some_and(|name| name.starts_with(prefix)) {
            to_remove.push(tag.clone());
        }
    });
    for tag in to_remove {
        buffer.remove_tag(&tag, start, end);
    }
}

/// Famílias de fonte instaladas no sistema, em ordem alfabética — usa o
/// mapa de fontes do Pango diretamente (mais simples e sempre atualizado do
/// que a lista estática/consulta via IPC que o Electron precisava fazer).
pub fn system_font_families() -> Vec<String> {
    let mut names: Vec<String> = pangocairo::FontMap::default().list_families().iter().map(|family| family.name().to_string()).collect();
    names.sort();
    names.dedup();
    names
}

/// Aplica família e/ou tamanho sobre a seleção atual — `None` em qualquer
/// um dos dois significa "não mexe nesse atributo" (o outro pode continuar
/// sendo aplicado sozinho).
pub fn apply_font_style(buffer: &TextBuffer, family: Option<&str>, size_pt: Option<&str>) {
    let Some((start, end)) = buffer.selection_bounds() else { return };
    let table = buffer.tag_table();

    if let Some(family) = family {
        remove_tags_with_prefix(buffer, &table, &start, &end, FAMILY_PREFIX);
        buffer.apply_tag(&family_tag(buffer, family), &start, &end);
    }
    if let Some(size_pt) = size_pt {
        remove_tags_with_prefix(buffer, &table, &start, &end, SIZE_PREFIX);
        buffer.apply_tag(&size_tag(buffer, size_pt), &start, &end);
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::formatting::doc_from_buffer;

    pub(crate) fn family_tag_is_created_once_and_reused() {
        let buffer = TextBuffer::new(None);
        let first = family_tag(&buffer, "Georgia");
        let second = family_tag(&buffer, "Georgia");
        assert_eq!(first, second, "mesma família deve reusar a mesma tag, não criar duplicada");
    }

    pub(crate) fn tag_name_extraction_round_trips() {
        assert_eq!(family_from_tag_name("font-family:Georgia"), Some("Georgia"));
        assert_eq!(size_from_tag_name("font-size:14"), Some("14"));
        assert_eq!(family_from_tag_name("bold"), None);
    }

    pub(crate) fn apply_font_style_combines_into_single_text_style_mark() {
        let buffer = TextBuffer::new(None);
        buffer.set_text("texto estilizado");
        buffer.select_range(&buffer.iter_at_offset(0), &buffer.iter_at_offset(5)); // "texto"
        apply_font_style(&buffer, Some("Georgia"), Some("14"));

        let doc = doc_from_buffer(&buffer);
        let run = &doc.content.as_ref().unwrap()[0].content.as_ref().unwrap()[0];
        let mark = run.marks.as_ref().unwrap().iter().find(|m| m.kind == "textStyle").expect("deve ter uma mark textStyle");
        let attrs = mark.attrs.as_ref().unwrap();
        assert_eq!(attrs.get("fontFamily").and_then(|v| v.as_str()), Some("Georgia"));
        assert_eq!(attrs.get("fontSize").and_then(|v| v.as_str()), Some("14pt"), "tamanho deve serializar com sufixo 'pt', igual ao Electron");
    }
}
