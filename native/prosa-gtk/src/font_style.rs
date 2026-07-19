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

use gtk::gio::prelude::*;
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

/// Seleção atual, ou (se não houver seleção) um "intervalo" de largura zero
/// no cursor — usado tanto pra aplicar quanto pra ler o família/tamanho
/// ativos.
fn selection_or_cursor(buffer: &TextBuffer) -> (TextIter, TextIter) {
    buffer.selection_bounds().unwrap_or_else(|| {
        let iter = buffer.iter_at_offset(buffer.cursor_position());
        (iter.clone(), iter)
    })
}

/// Valor (só a parte depois do prefixo) da tag com nome `prefix<valor>` na
/// posição `iter`, se houver.
fn tag_value_at(iter: &TextIter, prefix: &str) -> Option<String> {
    iter.tags().iter().find_map(|tag| tag.name().and_then(|name| name.strip_prefix(prefix).map(str::to_string)))
}

/// Valor da tag `prefix<valor>` uniforme por todo o intervalo `[start, end)`
/// (ou só na posição, se `start == end`) — `None` se não houver tag em
/// algum ponto, ou se o valor mudar no meio do intervalo (seleção com mais
/// de uma família/tamanho misturados).
fn uniform_tag_value(start: &TextIter, end: &TextIter, prefix: &str) -> Option<String> {
    let first = tag_value_at(start, prefix)?;
    if start == end {
        return Some(first);
    }
    let mut iter = start.clone();
    while &iter < end {
        if tag_value_at(&iter, prefix).as_deref() != Some(first.as_str()) {
            return None;
        }
        if !iter.forward_char() {
            break;
        }
    }
    Some(first)
}

/// Família ativa na seleção atual (ou no cursor, sem seleção) — `None` se
/// não houver família explícita, ou se a seleção misturar mais de uma.
pub fn active_family(buffer: &TextBuffer) -> Option<String> {
    let (start, end) = selection_or_cursor(buffer);
    uniform_tag_value(&start, &end, FAMILY_PREFIX)
}

/// Tamanho ativo (só o número) na seleção atual — mesma regra de
/// `active_family`.
pub fn active_size(buffer: &TextBuffer) -> Option<String> {
    let (start, end) = selection_or_cursor(buffer);
    uniform_tag_value(&start, &end, SIZE_PREFIX)
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

/// Constrói o seletor de família como um `GtkMenuButton` com popover
/// próprio (busca + lista filtrável), em vez do `GtkDropDown` com
/// `enable_search`: o campo de busca desse último não recebe foco
/// automático ao abrir o popover (limitação conhecida do GTK4), então
/// digitar não filtra nada até o usuário clicar manualmente no campo —
/// aqui o foco é garantido explicitamente em `popover.connect_show`.
pub fn build_family_picker(buffer: &TextBuffer, families: &[String]) -> gtk::MenuButton {
    let buffer = buffer.clone();
    let family_refs: Vec<&str> = families.iter().map(String::as_str).collect();
    let family_list = gtk::StringList::new(&family_refs);

    let expression = gtk::PropertyExpression::new(gtk::StringObject::static_type(), gtk::Expression::NONE, "string");
    let filter = gtk::StringFilter::new(Some(expression));
    filter.set_match_mode(gtk::StringFilterMatchMode::Substring);
    filter.set_ignore_case(true);

    let filter_model = gtk::FilterListModel::new(Some(family_list), Some(filter.clone()));
    let selection = gtk::SingleSelection::new(Some(filter_model));

    let factory = gtk::SignalListItemFactory::new();
    factory.connect_setup(|_, list_item| {
        let label = gtk::Label::builder().xalign(0.0).margin_start(6).margin_end(6).margin_top(2).margin_bottom(2).build();
        list_item.downcast_ref::<gtk::ListItem>().expect("fábrica sempre entrega um ListItem").set_child(Some(&label));
    });
    factory.connect_bind(|_, list_item| {
        let list_item = list_item.downcast_ref::<gtk::ListItem>().expect("fábrica sempre entrega um ListItem");
        let Some(string_object) = list_item.item().and_downcast::<gtk::StringObject>() else { return };
        let Some(label) = list_item.child().and_downcast::<gtk::Label>() else { return };
        label.set_label(&string_object.string());
    });

    let list_view = gtk::ListView::new(Some(selection), Some(factory));
    // Padrão do `GtkListView` exige duplo clique (ou Enter) pra ativar —
    // nada acontecia com um clique só, o que parecia "a família não muda".
    list_view.set_single_click_activate(true);
    let scrolled = gtk::ScrolledWindow::builder().child(&list_view).min_content_height(280).min_content_width(220).build();

    let search_entry = gtk::SearchEntry::builder().placeholder_text("Buscar fonte...").build();
    search_entry.connect_search_changed(glib::clone!(
        #[strong]
        filter,
        move |entry| filter.set_search(Some(&entry.text()))
    ));

    let popover_content =
        gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(6).margin_top(6).margin_bottom(6).margin_start(6).margin_end(6).build();
    popover_content.append(&search_entry);
    popover_content.append(&scrolled);

    let popover = gtk::Popover::builder().child(&popover_content).build();
    let menu_button = gtk::MenuButton::builder().label("Fonte").tooltip_text("Família da fonte").popover(&popover).build();

    popover.connect_show(glib::clone!(
        #[weak]
        search_entry,
        move |_| {
            glib::idle_add_local_once(glib::clone!(
                #[weak]
                search_entry,
                move || {
                    search_entry.grab_focus();
                }
            ));
        }
    ));

    list_view.connect_activate(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        menu_button,
        #[weak]
        popover,
        #[weak]
        search_entry,
        move |list_view, position| {
            let Some(model) = list_view.model() else { return };
            let Some(family) = model.item(position).and_downcast::<gtk::StringObject>() else { return };
            let family = family.string();
            apply_font_style(&buffer, Some(&family), None);
            menu_button.set_label(&family);
            search_entry.set_text("");
            popover.popdown();
        }
    ));

    menu_button
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

    pub(crate) fn active_family_and_size_are_none_without_any_tag() {
        let buffer = TextBuffer::new(None);
        buffer.set_text("sem estilo nenhum");
        buffer.select_range(&buffer.iter_at_offset(0), &buffer.iter_at_offset(4));
        assert_eq!(active_family(&buffer), None);
        assert_eq!(active_size(&buffer), None);
    }

    pub(crate) fn active_family_and_size_reflect_uniform_selection() {
        let buffer = TextBuffer::new(None);
        buffer.set_text("texto uniforme");
        buffer.select_range(&buffer.iter_at_offset(0), &buffer.iter_at_offset(5)); // "texto"
        apply_font_style(&buffer, Some("Georgia"), Some("14"));

        assert_eq!(active_family(&buffer).as_deref(), Some("Georgia"));
        assert_eq!(active_size(&buffer).as_deref(), Some("14"));
    }

    pub(crate) fn active_family_and_size_are_none_when_selection_mixes_values() {
        let buffer = TextBuffer::new(None);
        buffer.set_text("Georgia e Arial");
        buffer.select_range(&buffer.iter_at_offset(0), &buffer.iter_at_offset(7)); // "Georgia"
        apply_font_style(&buffer, Some("Georgia"), Some("14"));
        buffer.select_range(&buffer.iter_at_offset(10), &buffer.iter_at_offset(15)); // "Arial"
        apply_font_style(&buffer, Some("Arial"), Some("18"));

        // seleção cobrindo os dois trechos com famílias/tamanhos diferentes
        buffer.select_range(&buffer.iter_at_offset(0), &buffer.iter_at_offset(15));
        assert_eq!(active_family(&buffer), None, "seleção com mais de uma família deve ficar em branco");
        assert_eq!(active_size(&buffer), None, "seleção com mais de um tamanho deve ficar em branco");
    }

    pub(crate) fn active_family_reflects_cursor_position_without_selection() {
        let buffer = TextBuffer::new(None);
        buffer.set_text("texto estilizado");
        buffer.select_range(&buffer.iter_at_offset(0), &buffer.iter_at_offset(5));
        apply_font_style(&buffer, Some("Georgia"), None);

        buffer.place_cursor(&buffer.iter_at_offset(2)); // dentro de "texto", sem seleção
        assert_eq!(active_family(&buffer).as_deref(), Some("Georgia"));

        buffer.place_cursor(&buffer.iter_at_offset(10)); // fora do trecho estilizado
        assert_eq!(active_family(&buffer), None);
    }
}
