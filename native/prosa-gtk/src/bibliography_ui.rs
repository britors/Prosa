//! Diálogo de bibliografia: buscar/inserir citação, importar `.bib` e
//! inserir a lista de referências formatada — espelha o fluxo real do
//! `BibliographyDialog` do Electron (busca + seletor de estilo + lista de
//! entradas + os três botões de ação), usando o padrão de diálogo já
//! estabelecido no app nativo (`AdwAlertDialog` + `extra_child`, igual
//! `ai_ui::open_settings_dialog`) em vez do modal HTML customizado do
//! original.
//!
//! Reaproveita o mesmo `workspace_root` do painel de backlinks
//! (`main.rs::BacklinksPanel`) — é a mesma pasta que guarda tanto os
//! `.prosa` escaneados pra wikilinks quanto o `.prosa-bibliography.json`.

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use adw::prelude::*;
use prosa_doc::bibliography::{self, BibliographyEntry, BibliographyStyle};

use crate::citation;
use crate::formatting::{doc_from_buffer, set_heading_level};

const STYLES: [BibliographyStyle; 3] = [BibliographyStyle::Abnt, BibliographyStyle::Apa, BibliographyStyle::Ieee];

fn style_label(style: BibliographyStyle) -> &'static str {
    match style {
        BibliographyStyle::Abnt => "ABNT",
        BibliographyStyle::Apa => "APA",
        BibliographyStyle::Ieee => "IEEE",
    }
}

fn now_iso() -> String {
    glib::DateTime::now_utc().and_then(|dt| dt.format_iso8601()).map(|s| s.to_string()).unwrap_or_default()
}

/// Texto de exibição pra uma citação recém-inserida sem seleção prévia:
/// "(Sobrenome, Ano)" a partir do primeiro autor da string bruta BibTeX.
fn display_text(entry: &BibliographyEntry) -> String {
    let family = entry.author.split(" and ").next().unwrap_or("").split(',').next().unwrap_or("").trim();
    let year = if entry.year.is_empty() { "s.d." } else { entry.year.as_str() };
    if family.is_empty() {
        format!("({year})")
    } else {
        format!("({family}, {year})")
    }
}

/// Aplica a citação: sobre a seleção atual, se houver (igual ao Electron —
/// preserva o texto visível escolhido pelo usuário); sem seleção, insere
/// `display_text` no cursor e marca esse texto recém-inserido.
fn insert_citation(buffer: &gtk::TextBuffer, entry: &BibliographyEntry) {
    if buffer.selection_bounds().is_some() {
        citation::apply_citation(buffer, &entry.key);
        return;
    }
    let text = display_text(entry);
    let start_offset = buffer.cursor_position();
    let mut cursor_iter = buffer.iter_at_offset(start_offset);
    buffer.insert(&mut cursor_iter, &text);
    let start = buffer.iter_at_offset(start_offset);
    let end = buffer.iter_at_offset(start_offset + text.chars().count() as i32);
    let tag = citation::citation_tag(buffer, &entry.key);
    buffer.apply_tag(&tag, &start, &end);
}

/// Gera a lista de referências das citações do documento e insere no fim
/// do buffer como um título "Referências" + um parágrafo por entrada. Sem
/// suporte a lista numerada no modelo de documento nativo ainda, então o
/// número é escrito à mão pros estilos que não o embutem no próprio texto
/// formatado (só o IEEE já vem com "[n]").
fn insert_bibliography(buffer: &gtk::TextBuffer, state: &bibliography::WorkspaceBibliographyState) {
    let doc = doc_from_buffer(buffer);
    let keys = bibliography::extract_citations(&doc);
    if keys.is_empty() {
        return;
    }
    let rendered = bibliography::render_bibliography(&keys, &state.entries, state.style);
    if rendered.is_empty() {
        return;
    }

    let mut end_iter = buffer.end_iter();
    buffer.insert(&mut end_iter, "\nReferências");
    let heading_line = buffer.line_count() - 1;
    set_heading_level(buffer, heading_line, Some(2));

    for (index, entry_text) in rendered.iter().enumerate() {
        let line = match state.style {
            BibliographyStyle::Ieee => entry_text.clone(),
            _ => format!("{}. {entry_text}", index + 1),
        };
        let mut end_iter = buffer.end_iter();
        buffer.insert(&mut end_iter, &format!("\n{line}"));
    }
}

/// Abre o diálogo de bibliografia. Exige um workspace já escolhido (mesma
/// pasta do painel de backlinks) — sem isso não há onde ler/gravar
/// `.prosa-bibliography.json`.
pub fn open_bibliography_dialog(window: &adw::ApplicationWindow, buffer: &gtk::TextBuffer, workspace_root: &Rc<RefCell<Option<PathBuf>>>) {
    let Some(root) = workspace_root.borrow().clone() else {
        let alert = adw::AlertDialog::new(
            Some("Nenhum workspace selecionado"),
            Some("Escolha uma pasta de workspace no painel de backlinks antes de gerenciar a bibliografia."),
        );
        alert.add_response("ok", "OK");
        alert.present(Some(window));
        return;
    };

    let state = Rc::new(RefCell::new(bibliography::read_bibliography(&root)));
    let visible_keys: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));

    let style_labels: Vec<&str> = STYLES.iter().map(|style| style_label(*style)).collect();
    let style_model = gtk::StringList::new(&style_labels);
    let style_dropdown = gtk::DropDown::new(Some(style_model), gtk::Expression::NONE);
    let current_style_index = STYLES.iter().position(|style| *style == state.borrow().style).unwrap_or(0);
    style_dropdown.set_selected(current_style_index as u32);

    let search_entry = gtk::SearchEntry::builder().placeholder_text("Buscar por título, autor ou chave...").build();

    let entries_list = gtk::ListBox::new();
    entries_list.add_css_class("navigation-sidebar");
    entries_list.set_selection_mode(gtk::SelectionMode::Single);
    let entries_scrolled = gtk::ScrolledWindow::builder().child(&entries_list).min_content_height(220).build();

    let status_label = gtk::Label::builder().xalign(0.0).css_classes(["dim-label"]).build();

    let refresh_list = glib::clone!(
        #[weak]
        entries_list,
        #[weak]
        search_entry,
        #[strong]
        state,
        #[strong]
        visible_keys,
        move || {
            while let Some(row) = entries_list.row_at_index(0) {
                entries_list.remove(&row);
            }
            let query = search_entry.text().to_lowercase();
            let mut keys = visible_keys.borrow_mut();
            keys.clear();
            for entry in &state.borrow().entries {
                let haystack = format!("{} {} {}", entry.title, entry.author, entry.key).to_lowercase();
                if !query.is_empty() && !haystack.contains(&query) {
                    continue;
                }
                let title = if entry.title.is_empty() { entry.key.clone() } else { entry.title.clone() };
                let label = gtk::Label::builder()
                    .label(format!("{title}\n{} · {}", entry.author, entry.year))
                    .xalign(0.0)
                    .wrap(true)
                    .margin_start(8)
                    .margin_end(8)
                    .margin_top(6)
                    .margin_bottom(6)
                    .build();
                entries_list.append(&label);
                keys.push(entry.key.clone());
            }
        }
    );
    refresh_list();

    search_entry.connect_search_changed(glib::clone!(
        #[strong]
        refresh_list,
        move |_| refresh_list()
    ));

    let import_button = gtk::Button::with_label("Importar .bib...");
    let insert_citation_button = gtk::Button::with_label("Inserir citação");
    let insert_bibliography_button = gtk::Button::with_label("Inserir lista de referências");

    let content = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(8).build();
    let style_row = gtk::Box::builder().orientation(gtk::Orientation::Horizontal).spacing(8).build();
    style_row.append(&gtk::Label::builder().label("Estilo:").build());
    style_row.append(&style_dropdown);
    style_row.append(&import_button);
    content.append(&style_row);
    content.append(&search_entry);
    content.append(&entries_scrolled);
    content.append(&status_label);
    let actions_row = gtk::Box::builder().orientation(gtk::Orientation::Horizontal).spacing(8).homogeneous(true).build();
    actions_row.append(&insert_citation_button);
    actions_row.append(&insert_bibliography_button);
    content.append(&actions_row);

    let dialog = adw::AlertDialog::builder().heading("Bibliografia").extra_child(&content).build();
    dialog.add_response("close", "Fechar");
    dialog.set_close_response("close");
    dialog.present(Some(window));

    style_dropdown.connect_selected_notify(glib::clone!(
        #[strong]
        state,
        #[strong]
        root,
        move |dropdown| {
            let style = STYLES[dropdown.selected() as usize];
            let mut current = state.borrow_mut();
            current.style = style;
            let _ = bibliography::write_bibliography(&root, &current);
        }
    ));

    import_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[strong]
        root,
        #[strong]
        state,
        #[strong]
        refresh_list,
        #[weak]
        status_label,
        move |_| {
            let dialog = gtk::FileDialog::builder().title("Importar BibTeX").modal(true).build();
            let filter = gtk::FileFilter::new();
            filter.set_name(Some("BibTeX (.bib)"));
            filter.add_suffix("bib");
            filter.add_suffix("txt");
            let filters = gtk::gio::ListStore::new::<gtk::FileFilter>();
            filters.append(&filter);
            dialog.set_filters(Some(&filters));

            glib::spawn_future_local(glib::clone!(
                #[weak]
                window,
                #[strong]
                root,
                #[strong]
                state,
                #[strong]
                refresh_list,
                #[weak]
                status_label,
                async move {
                    let Ok(file) = dialog.open_future(Some(&window)).await else { return };
                    let Some(path) = file.path() else { return };
                    let Ok(content) = std::fs::read_to_string(&path) else {
                        status_label.set_text("Não foi possível ler o arquivo escolhido.");
                        return;
                    };
                    let before = state.borrow().entries.len();
                    let updated = bibliography::import_bibtex(&root, &content, now_iso());
                    let imported = updated.entries.len();
                    *state.borrow_mut() = updated;
                    refresh_list();
                    status_label.set_text(&format!("Importado: {} entrada(s) na biblioteca ({imported} no total, antes {before}).", imported.saturating_sub(before).max(0)));
                }
            ));
        }
    ));

    insert_citation_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        #[strong]
        state,
        #[strong]
        visible_keys,
        #[weak]
        entries_list,
        #[weak]
        status_label,
        move |_| {
            let Some(row) = entries_list.selected_row() else {
                status_label.set_text("Selecione uma entrada na lista primeiro.");
                return;
            };
            let Some(key) = visible_keys.borrow().get(row.index() as usize).cloned() else { return };
            let Some(entry) = state.borrow().entries.iter().find(|entry| entry.key == key).cloned() else { return };
            insert_citation(&buffer, &entry);
        }
    ));

    insert_bibliography_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        #[strong]
        state,
        #[weak]
        status_label,
        move |_| {
            insert_bibliography(&buffer, &state.borrow());
            status_label.set_text("Lista de referências inserida no fim do documento.");
        }
    ));
}
