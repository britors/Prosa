//! Prosa nativo — casca GTK4 + libadwaita (MVP).
//!
//! Cobre o escopo do MVP da migração: shell nativo, editor de texto simples
//! sobre `GtkTextView` (com negrito/itálico/sublinhado/tachado) e abrir/salvar
//! o formato `.prosa` existente. Sem paginação, tabelas, imagens ou estrutura
//! de bloco (títulos) ainda — isso é trabalho das fases seguintes (ver issues
//! da epic "Migração do Prosa para Rust + GTK4").

mod ai_ui;
mod find_replace;
mod formatting;
mod live_pagination;
mod print;
mod spellcheck;

use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, gio, glib};
use prosa_doc::{docx, odt, rtf};
use prosa_doc::{DocumentMetadata, ProsaFile};

use find_replace::{FindReplace, SearchOptions};
use formatting::{doc_from_buffer, load_doc_into_buffer, setup_mark_tags, toggle_mark};
use live_pagination::{count_words_and_sentences, LivePagination};
use spellcheck::{LiveSpellcheck, SpellChecker};

const APP_ID: &str = "br.com.rodrigobrito.Prosa.Native";

/// Estado do documento atualmente aberto na janela.
struct DocumentState {
    path: Option<PathBuf>,
    metadata: DocumentMetadata,
    /// HTML de cabeçalho/rodapé carregado de um `.prosa` existente. A UI
    /// nativa ainda não permite editá-los — são só preservados ao salvar e
    /// usados (como texto puro) na exportação para PDF.
    header: Option<String>,
    footer: Option<String>,
}

fn now_iso() -> String {
    glib::DateTime::now_utc()
        .and_then(|dt| dt.format_iso8601())
        .map(|s| s.to_string())
        .unwrap_or_default()
}

fn new_document_state() -> DocumentState {
    DocumentState {
        path: None,
        metadata: DocumentMetadata {
            title: "Sem título".to_string(),
            author: whoami_fallback(),
            created_at: now_iso(),
            modified_at: now_iso(),
        },
        header: None,
        footer: None,
    }
}

/// Melhor esforço para um nome de autor padrão, sem depender de crates extras.
fn whoami_fallback() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default()
}

fn prosa_file_filter() -> gtk::FileFilter {
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("Documento Prosa (.prosa)"));
    filter.add_suffix("prosa");
    filter
}

fn docx_file_filter() -> gtk::FileFilter {
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("Word (.docx)"));
    filter.add_suffix("docx");
    filter
}

fn odt_file_filter() -> gtk::FileFilter {
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("OpenDocument (.odt)"));
    filter.add_suffix("odt");
    filter
}

fn rtf_file_filter() -> gtk::FileFilter {
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("Rich Text (.rtf)"));
    filter.add_suffix("rtf");
    filter
}

/// Nome do arquivo sem extensão, usado como título quando um `.docx`/`.odt`/
/// `.rtf` (que não carregam metadados como o `.prosa`) é aberto.
fn file_stem_title(path: &std::path::Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Sem título".to_string())
}

/// Refaz a busca a partir do estado atual dos campos/opções e atualiza o
/// contador "N/total" — chamado a cada mudança no termo, nas opções, ou
/// depois de qualquer substituição.
#[allow(clippy::too_many_arguments)]
fn refresh_search(
    buffer: &gtk::TextBuffer,
    find_replace: &Rc<RefCell<FindReplace>>,
    search_entry: &gtk::SearchEntry,
    case_toggle: &gtk::ToggleButton,
    whole_word_toggle: &gtk::ToggleButton,
    regex_toggle: &gtk::ToggleButton,
    match_position_label: &gtk::Label,
) {
    let options = SearchOptions {
        case_sensitive: case_toggle.is_active(),
        whole_word: whole_word_toggle.is_active(),
        regex: regex_toggle.is_active(),
    };
    let mut fr = find_replace.borrow_mut();
    fr.search(buffer, &search_entry.text(), options);
    let total = fr.match_count();
    let current = fr.current_position().unwrap_or(0);
    match_position_label.set_text(&format!("{current}/{total}"));
}

/// Atualiza a barra de status com contagem de palavras, frases e páginas.
fn update_status_bar(buffer: &gtk::TextBuffer, pagination: &Rc<LivePagination>, label: &gtk::Label) {
    let (start, end) = buffer.bounds();
    let text = buffer.text(&start, &end, false);
    let (words, sentences) = count_words_and_sentences(&text);
    let pages = pagination.page_count();
    label.set_text(&format!(
        "{words} palavra{} · {sentences} frase{} · {pages} página{}",
        if words == 1 { "" } else { "s" },
        if sentences == 1 { "" } else { "s" },
        if pages == 1 { "" } else { "s" },
    ));
}

/// Palavra sob um clique do menu de contexto, com o suficiente pra
/// substituí-la por uma sugestão ou adicioná-la ao dicionário.
#[derive(Clone)]
struct PendingMisspelling {
    word: String,
    start_offset: i32,
    end_offset: i32,
    suggestions: Vec<String>,
}

/// Palavra sob o iterador dado, usando os limites de palavra nativos do
/// GTK (podem incluir números/apóstrofos — mais permissivo que a
/// tokenização por caracteres alfabéticos que `spellcheck::find_misspelled_ranges`
/// usa pro sublinhado; a diferença nas bordas é aceitável aqui, é só pra
/// resolver "qual palavra o usuário clicou").
fn word_at_iter(buffer: &gtk::TextBuffer, iter: &gtk::TextIter) -> Option<(String, i32, i32)> {
    if !iter.inside_word() {
        return None;
    }
    let mut start = iter.clone();
    if !start.starts_word() {
        start.backward_word_start();
    }
    let mut end = iter.clone();
    if !end.ends_word() {
        end.forward_word_end();
    }
    let word = buffer.text(&start, &end, false).to_string();
    if word.is_empty() {
        return None;
    }
    Some((word, start.offset(), end.offset()))
}

/// Recria os indicadores de quebra de página no overlay, um por ponto de
/// quebra do último recálculo (ver `LivePagination`). Cada indicador é um
/// widget comum, sem nenhuma relação com o buffer de texto — só a cor da
/// "mesa" aparecendo por cima da folha, sem texto.
fn sync_break_lines(overlay: &gtk::Overlay, break_line_widgets: &Rc<RefCell<Vec<(gtk::Widget, i32)>>>, breaks: &[i32]) {
    let mut widgets = break_line_widgets.borrow_mut();
    for (widget, _) in widgets.drain(..) {
        overlay.remove_overlay(&widget);
    }
    for y in breaks {
        let line = gtk::Box::new(gtk::Orientation::Vertical, 0);
        line.add_css_class("prosa-page-break-line");
        line.set_can_target(false);
        overlay.add_overlay(&line);
        widgets.push((line.upcast::<gtk::Widget>(), *y));
    }
    drop(widgets);
    overlay.queue_allocate();
}

/// Lê um documento em formato estrangeiro (`docx`/`odt`/`rtf`) pela extensão.
fn read_foreign_document(path: &std::path::Path, extension: &str) -> Result<prosa_doc::TipTapNode, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    match extension {
        "docx" => docx::read_docx(&bytes).map_err(|e| e.to_string()),
        "odt" => odt::read_odt(&bytes).map_err(|e| e.to_string()),
        "rtf" => rtf::read_rtf(&bytes).map_err(|e| e.to_string()),
        other => Err(format!("formato não suportado: {other}")),
    }
}

/// A "folha" (`GtkTextView`) é sempre branca (papel), com largura fixa de
/// A4, centralizada sobre um fundo escuro (a "mesa" ao redor) — janela e
/// botões continuam seguindo o tema claro/escuro do sistema à parte disso.
fn install_page_css() {
    let provider = gtk::CssProvider::new();
    provider.load_from_string(
        "textview.prosa-page, textview.prosa-page text { background-color: #ffffff; color: #1a1a1a; }\n\
         scrolledwindow.prosa-desk, box.prosa-page-break-line { background-color: #2e2e2e; }",
    );
    if let Some(display) = gtk::gdk::Display::default() {
        gtk::style_context_add_provider_for_display(&display, &provider, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);
    }
}

fn build_window(app: &adw::Application) {
    install_page_css();

    let text_view = gtk::TextView::builder()
        .wrap_mode(gtk::WrapMode::Word)
        .top_margin(live_pagination::MARGIN_TOP_PX)
        .bottom_margin(live_pagination::MARGIN_BOTTOM_PX)
        .left_margin(live_pagination::MARGIN_LEFT_PX)
        .right_margin(live_pagination::MARGIN_RIGHT_PX)
        .width_request(live_pagination::PAGE_WIDTH_PX)
        .hexpand(false)
        .halign(gtk::Align::Center)
        .build();
    text_view.add_css_class("prosa-page");
    let buffer = text_view.buffer();
    setup_mark_tags(&buffer);

    let scrolled = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Automatic)
        .child(&text_view)
        .vexpand(true)
        .build();
    scrolled.add_css_class("prosa-desk");

    // As linhas de quebra de página flutuam por cima do texto (GtkOverlay),
    // sem inserir nada no buffer — ver o histórico em live_pagination.rs.
    let overlay = gtk::Overlay::new();
    overlay.set_child(Some(&scrolled));

    let break_line_widgets: Rc<RefCell<Vec<(gtk::Widget, i32)>>> = Rc::new(RefCell::new(Vec::new()));

    overlay.connect_get_child_position(glib::clone!(
        #[weak]
        text_view,
        #[strong]
        break_line_widgets,
        #[upgrade_or]
        None,
        move |overlay, widget| {
            let buffer_y = break_line_widgets.borrow().iter().find(|(w, _)| w == widget).map(|(_, y)| *y)?;
            let (_, window_y) = text_view.buffer_to_window_coords(gtk::TextWindowType::Widget, 0, buffer_y);
            #[allow(deprecated)]
            let (_, oy) = text_view.translate_coordinates(overlay, 0.0, window_y as f64)?;
            // Só a largura da própria folha (não a tela toda) — do
            // contrário o indicador cobre a barra de rolagem, que fica
            // fora dessa faixa.
            let x = ((overlay.width() - live_pagination::PAGE_WIDTH_PX) / 2).max(0);
            Some(gdk::Rectangle::new(x, oy.round() as i32, live_pagination::PAGE_WIDTH_PX, 32))
        }
    ));

    // A rolagem não realoca o overlay sozinha (ele não muda de tamanho), só
    // reposiciona os filhos quando algo pede uma realocação explicitamente.
    scrolled.vadjustment().connect_value_changed(glib::clone!(
        #[weak]
        overlay,
        move |_| overlay.queue_allocate()
    ));

    let pagination = Rc::new(LivePagination::default());

    let spellchecker = Rc::new(SpellChecker::new());
    let live_spellcheck = Rc::new(LiveSpellcheck::new(spellchecker.clone()));
    if !spellchecker.is_available() {
        eprintln!("aviso: nenhum dicionário de corretor ortográfico encontrado (pt_BR/en_US) — sublinhado desativado");
    }

    let status_label = gtk::Label::builder().xalign(0.0).margin_start(12).margin_end(12).margin_top(4).margin_bottom(4).build();
    status_label.add_css_class("dim-label");

    let state = Rc::new(RefCell::new(new_document_state()));

    let title_widget = adw::WindowTitle::new("Prosa", "Sem título");

    let open_button = gtk::Button::from_icon_name("document-open-symbolic");
    open_button.set_tooltip_text(Some("Abrir (.prosa ou .docx)"));
    let save_button = gtk::Button::from_icon_name("document-save-symbolic");
    save_button.set_tooltip_text(Some("Salvar (.prosa)"));

    let bold_button = gtk::Button::from_icon_name("format-text-bold-symbolic");
    bold_button.set_tooltip_text(Some("Negrito (Ctrl+B)"));
    let italic_button = gtk::Button::from_icon_name("format-text-italic-symbolic");
    italic_button.set_tooltip_text(Some("Itálico (Ctrl+I)"));
    let underline_button = gtk::Button::from_icon_name("format-text-underline-symbolic");
    underline_button.set_tooltip_text(Some("Sublinhado (Ctrl+U)"));
    let strike_button = gtk::Button::from_icon_name("format-text-strikethrough-symbolic");
    strike_button.set_tooltip_text(Some("Tachado"));

    let ai_provider: ai_ui::AiSelectedProvider = Rc::new(Cell::new(prosa_doc::ai::AiProvider::OpenAi));

    let ai_menu = gio::Menu::new();
    let ai_actions_section = gio::Menu::new();
    for index in 0..ai_ui::ACTIONS_MENU.len() {
        let (label, _) = ai_ui::ACTIONS_MENU[index];
        ai_actions_section.append(Some(label), Some(&format!("win.ai-action-{index}")));
    }
    ai_menu.append_section(None, &ai_actions_section);
    let ai_settings_section = gio::Menu::new();
    ai_settings_section.append(Some("Configurar IA..."), Some("win.ai-settings"));
    ai_menu.append_section(None, &ai_settings_section);
    let ai_menu_button = gtk::MenuButton::builder().label("IA").tooltip_text("Ações de IA").menu_model(&ai_menu).build();

    let export_pdf_button = gtk::Button::from_icon_name("document-export-symbolic");
    export_pdf_button.set_tooltip_text(Some("Exportar PDF"));

    let export_menu = gio::Menu::new();
    export_menu.append(Some("Word (.docx)"), Some("win.export-docx"));
    export_menu.append(Some("OpenDocument (.odt)"), Some("win.export-odt"));
    export_menu.append(Some("Rich Text (.rtf)"), Some("win.export-rtf"));
    let export_menu_button = gtk::MenuButton::builder()
        .icon_name("view-more-symbolic")
        .tooltip_text("Exportar como...")
        .menu_model(&export_menu)
        .build();

    let header_bar = adw::HeaderBar::builder().title_widget(&title_widget).build();
    header_bar.pack_start(&open_button);
    header_bar.pack_start(&save_button);
    header_bar.pack_start(&gtk::Separator::new(gtk::Orientation::Vertical));
    header_bar.pack_start(&bold_button);
    header_bar.pack_start(&italic_button);
    header_bar.pack_start(&underline_button);
    header_bar.pack_start(&strike_button);
    header_bar.pack_start(&gtk::Separator::new(gtk::Orientation::Vertical));
    header_bar.pack_start(&ai_menu_button);
    header_bar.pack_end(&export_menu_button);
    header_bar.pack_end(&export_pdf_button);

    // Barra de localizar/substituir: escondida por padrão, revelada com
    // Ctrl+F. Um único bloco cobrindo busca e substituição (em vez das
    // duas linhas condicionais do Electron) — mais simples de manter.
    let search_entry = gtk::SearchEntry::builder().placeholder_text("Localizar").hexpand(true).build();
    let replace_entry = gtk::Entry::builder().placeholder_text("Substituir por").hexpand(true).build();
    let match_position_label = gtk::Label::builder().label("0/0").css_classes(["dim-label"]).width_chars(6).build();
    let find_prev_button = gtk::Button::from_icon_name("go-up-symbolic");
    find_prev_button.set_tooltip_text(Some("Anterior (Shift+Enter)"));
    let find_next_button = gtk::Button::from_icon_name("go-down-symbolic");
    find_next_button.set_tooltip_text(Some("Próximo (Enter)"));
    let case_toggle = gtk::ToggleButton::builder().label("Aa").tooltip_text("Diferenciar maiúsculas/minúsculas").build();
    let whole_word_toggle = gtk::ToggleButton::builder().label("Palavra").tooltip_text("Palavra inteira").build();
    let regex_toggle = gtk::ToggleButton::builder().label(".*").tooltip_text("Expressão regular").build();
    let replace_button = gtk::Button::with_label("Substituir");
    let replace_all_button = gtk::Button::with_label("Substituir todas");
    let find_close_button = gtk::Button::from_icon_name("window-close-symbolic");
    find_close_button.set_tooltip_text(Some("Fechar (Esc)"));

    let find_row = gtk::Box::builder().orientation(gtk::Orientation::Horizontal).spacing(6).build();
    find_row.append(&search_entry);
    find_row.append(&match_position_label);
    find_row.append(&find_prev_button);
    find_row.append(&find_next_button);
    find_row.append(&case_toggle);
    find_row.append(&whole_word_toggle);
    find_row.append(&regex_toggle);
    find_row.append(&find_close_button);

    let replace_row = gtk::Box::builder().orientation(gtk::Orientation::Horizontal).spacing(6).build();
    replace_row.append(&replace_entry);
    replace_row.append(&replace_button);
    replace_row.append(&replace_all_button);

    let find_bar = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(6)
        .margin_top(8)
        .margin_bottom(8)
        .margin_start(12)
        .margin_end(12)
        .build();
    find_bar.append(&find_row);
    find_bar.append(&replace_row);

    let find_bar_revealer = gtk::Revealer::builder().transition_type(gtk::RevealerTransitionType::SlideDown).child(&find_bar).build();

    let find_replace = Rc::new(RefCell::new(FindReplace::default()));

    // `AdwToolbarView::add_bottom_bar` combinado com um filho de largura fixa
    // (a folha A4 centralizada) entra num loop de remedição do GTK (altura
    // exigida cresce sem parar — travou o processo). Um `GtkBox` vertical
    // simples como conteúdo evita esse caminho de negociação de tamanho.
    let content_box = gtk::Box::new(gtk::Orientation::Vertical, 0);
    content_box.append(&overlay);
    content_box.append(&status_label);

    let toolbar_view = adw::ToolbarView::new();
    toolbar_view.add_top_bar(&header_bar);
    toolbar_view.add_top_bar(&find_bar_revealer);
    toolbar_view.set_content(Some(&content_box));

    let window = adw::ApplicationWindow::builder()
        .application(app)
        .title("Prosa")
        .default_width(900)
        .default_height(700)
        .content(&toolbar_view)
        .build();

    bold_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| toggle_mark(&buffer, "bold")
    ));
    italic_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| toggle_mark(&buffer, "italic")
    ));
    underline_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| toggle_mark(&buffer, "underline")
    ));
    strike_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| toggle_mark(&buffer, "strike")
    ));

    let key_controller = gtk::EventControllerKey::new();
    key_controller.connect_key_pressed(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        find_bar_revealer,
        #[weak]
        search_entry,
        #[upgrade_or]
        glib::Propagation::Proceed,
        move |_, keyval, _keycode, modifiers| {
            if modifiers.contains(gdk::ModifierType::CONTROL_MASK) {
                let lower = keyval.to_lower();
                if lower == gdk::Key::f {
                    find_bar_revealer.set_reveal_child(true);
                    search_entry.grab_focus();
                    return glib::Propagation::Stop;
                }
                let mark_name = if lower == gdk::Key::b {
                    Some("bold")
                } else if lower == gdk::Key::i {
                    Some("italic")
                } else if lower == gdk::Key::u {
                    Some("underline")
                } else {
                    None
                };
                if let Some(name) = mark_name {
                    toggle_mark(&buffer, name);
                    return glib::Propagation::Stop;
                }
            }
            glib::Propagation::Proceed
        }
    ));
    text_view.add_controller(key_controller);

    for toggle in [&case_toggle, &whole_word_toggle, &regex_toggle] {
        toggle.connect_toggled(glib::clone!(
            #[weak]
            buffer,
            #[strong]
            find_replace,
            #[weak]
            search_entry,
            #[weak]
            case_toggle,
            #[weak]
            whole_word_toggle,
            #[weak]
            regex_toggle,
            #[weak]
            match_position_label,
            move |_| refresh_search(&buffer, &find_replace, &search_entry, &case_toggle, &whole_word_toggle, &regex_toggle, &match_position_label)
        ));
    }

    search_entry.connect_search_changed(glib::clone!(
        #[weak]
        buffer,
        #[strong]
        find_replace,
        #[weak]
        search_entry,
        #[weak]
        case_toggle,
        #[weak]
        whole_word_toggle,
        #[weak]
        regex_toggle,
        #[weak]
        match_position_label,
        move |_| refresh_search(&buffer, &find_replace, &search_entry, &case_toggle, &whole_word_toggle, &regex_toggle, &match_position_label)
    ));

    // Enter simples = próximo match (via "activate" da GtkSearchEntry).
    search_entry.connect_activate(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        text_view,
        #[strong]
        find_replace,
        #[weak]
        match_position_label,
        move |_| {
            let mut fr = find_replace.borrow_mut();
            if let Some(mut iter) = fr.go_next(&buffer) {
                text_view.scroll_to_iter(&mut iter, 0.0, true, 0.0, 0.3);
            }
            let total = fr.match_count();
            let current = fr.current_position().unwrap_or(0);
            match_position_label.set_text(&format!("{current}/{total}"));
        }
    ));

    // Shift+Enter = anterior; Esc = fecha a barra. GtkSearchEntry não
    // distingue Shift no "activate", então precisa de um controlador de
    // tecla à parte.
    let search_key_controller = gtk::EventControllerKey::new();
    search_key_controller.connect_key_pressed(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        text_view,
        #[strong]
        find_replace,
        #[weak]
        match_position_label,
        #[weak]
        find_bar_revealer,
        #[upgrade_or]
        glib::Propagation::Proceed,
        move |_, keyval, _keycode, modifiers| {
            if keyval == gdk::Key::Escape {
                find_bar_revealer.set_reveal_child(false);
                find_replace.borrow_mut().clear(&buffer);
                text_view.grab_focus();
                return glib::Propagation::Stop;
            }
            if keyval == gdk::Key::Return && modifiers.contains(gdk::ModifierType::SHIFT_MASK) {
                let mut fr = find_replace.borrow_mut();
                if let Some(mut iter) = fr.go_previous(&buffer) {
                    text_view.scroll_to_iter(&mut iter, 0.0, true, 0.0, 0.3);
                }
                let total = fr.match_count();
                let current = fr.current_position().unwrap_or(0);
                match_position_label.set_text(&format!("{current}/{total}"));
                return glib::Propagation::Stop;
            }
            glib::Propagation::Proceed
        }
    ));
    search_entry.add_controller(search_key_controller);

    find_next_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        text_view,
        #[strong]
        find_replace,
        #[weak]
        match_position_label,
        move |_| {
            let mut fr = find_replace.borrow_mut();
            if let Some(mut iter) = fr.go_next(&buffer) {
                text_view.scroll_to_iter(&mut iter, 0.0, true, 0.0, 0.3);
            }
            let total = fr.match_count();
            let current = fr.current_position().unwrap_or(0);
            match_position_label.set_text(&format!("{current}/{total}"));
        }
    ));
    find_prev_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        text_view,
        #[strong]
        find_replace,
        #[weak]
        match_position_label,
        move |_| {
            let mut fr = find_replace.borrow_mut();
            if let Some(mut iter) = fr.go_previous(&buffer) {
                text_view.scroll_to_iter(&mut iter, 0.0, true, 0.0, 0.3);
            }
            let total = fr.match_count();
            let current = fr.current_position().unwrap_or(0);
            match_position_label.set_text(&format!("{current}/{total}"));
        }
    ));

    replace_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        #[strong]
        find_replace,
        #[weak]
        replace_entry,
        #[weak]
        search_entry,
        #[weak]
        case_toggle,
        #[weak]
        whole_word_toggle,
        #[weak]
        regex_toggle,
        #[weak]
        match_position_label,
        move |_| {
            find_replace.borrow().replace_current(&buffer, &replace_entry.text());
            refresh_search(&buffer, &find_replace, &search_entry, &case_toggle, &whole_word_toggle, &regex_toggle, &match_position_label);
        }
    ));
    replace_all_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        #[strong]
        find_replace,
        #[weak]
        replace_entry,
        #[weak]
        search_entry,
        #[weak]
        case_toggle,
        #[weak]
        whole_word_toggle,
        #[weak]
        regex_toggle,
        #[weak]
        match_position_label,
        move |_| {
            find_replace.borrow().replace_all(&buffer, &replace_entry.text());
            refresh_search(&buffer, &find_replace, &search_entry, &case_toggle, &whole_word_toggle, &regex_toggle, &match_position_label);
        }
    ));

    find_close_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        text_view,
        #[strong]
        find_replace,
        #[weak]
        find_bar_revealer,
        move |_| {
            find_bar_revealer.set_reveal_child(false);
            find_replace.borrow_mut().clear(&buffer);
            text_view.grab_focus();
        }
    ));

    // Menu de contexto do corretor ortográfico: GtkTextView só expõe um
    // `extra-menu` estático (GMenuModel), não um sinal dinâmico tipo
    // "populate-popup" — então a palavra sob o clique é resolvida na mão,
    // num gesto na fase de *captura* (roda antes do menu nativo abrir), e
    // o `extra-menu` é reconstruído ali mesmo.
    let pending_misspelling: Rc<RefCell<Option<PendingMisspelling>>> = Rc::new(RefCell::new(None));

    let spellcheck_actions = gio::SimpleActionGroup::new();
    for index in 0..spellcheck::MAX_SUGGESTIONS {
        let action = gio::SimpleAction::new(&format!("suggest-{index}"), None);
        action.connect_activate(glib::clone!(
            #[weak]
            buffer,
            #[strong]
            pending_misspelling,
            move |_, _| {
                let Some(pending) = pending_misspelling.borrow().clone() else { return };
                if let Some(suggestion) = pending.suggestions.get(index) {
                    let mut start = buffer.iter_at_offset(pending.start_offset);
                    let mut end = buffer.iter_at_offset(pending.end_offset);
                    buffer.delete(&mut start, &mut end);
                    buffer.insert(&mut start, suggestion);
                }
            }
        ));
        spellcheck_actions.add_action(&action);
    }
    let add_word_action = gio::SimpleAction::new("add-word", None);
    add_word_action.connect_activate(glib::clone!(
        #[weak]
        buffer,
        #[strong]
        pending_misspelling,
        #[strong]
        spellchecker,
        #[strong]
        live_spellcheck,
        move |_, _| {
            let Some(pending) = pending_misspelling.borrow().clone() else { return };
            spellchecker.add_to_dictionary(&pending.word);
            live_spellcheck.schedule_recompute(&buffer);
        }
    ));
    spellcheck_actions.add_action(&add_word_action);
    text_view.insert_action_group("spellcheck", Some(&spellcheck_actions));

    let right_click = gtk::GestureClick::new();
    right_click.set_button(3);
    right_click.set_propagation_phase(gtk::PropagationPhase::Capture);
    right_click.connect_pressed(glib::clone!(
        #[weak]
        text_view,
        #[weak]
        buffer,
        #[strong]
        spellchecker,
        #[strong]
        pending_misspelling,
        move |_, _n_press, x, y| {
            *pending_misspelling.borrow_mut() = None;
            let menu = gio::Menu::new();

            let (buffer_x, buffer_y) = text_view.window_to_buffer_coords(gtk::TextWindowType::Widget, x as i32, y as i32);
            if let Some(iter) = text_view.iter_at_location(buffer_x, buffer_y) {
                if let Some((word, start_offset, end_offset)) = word_at_iter(&buffer, &iter) {
                    if spellchecker.is_available() && !spellchecker.check(&word) {
                        let suggestions = spellchecker.suggest(&word);
                        if suggestions.is_empty() {
                            menu.append(Some("Nenhuma sugestão"), None::<&str>);
                        } else {
                            for (index, suggestion) in suggestions.iter().enumerate() {
                                menu.append(Some(suggestion), Some(&format!("spellcheck.suggest-{index}")));
                            }
                        }
                        menu.append(Some("Adicionar ao dicionário"), Some("spellcheck.add-word"));
                        *pending_misspelling.borrow_mut() =
                            Some(PendingMisspelling { word, start_offset, end_offset, suggestions });
                    }
                }
            }
            text_view.set_extra_menu(Some(&menu));
        }
    ));
    text_view.add_controller(right_click);

    update_status_bar(&buffer, &pagination, &status_label);
    buffer.connect_changed(glib::clone!(
        #[weak]
        text_view,
        #[weak]
        buffer,
        #[strong]
        pagination,
        #[weak]
        status_label,
        #[strong]
        live_spellcheck,
        move |_| {
            update_status_bar(&buffer, &pagination, &status_label);
            live_spellcheck.schedule_recompute(&buffer);
            pagination.schedule_recompute(
                &text_view,
                &buffer,
                glib::clone!(
                    #[weak]
                    buffer,
                    #[strong]
                    pagination,
                    #[weak]
                    status_label,
                    #[weak]
                    overlay,
                    #[strong]
                    break_line_widgets,
                    move || {
                        update_status_bar(&buffer, &pagination, &status_label);
                        sync_break_lines(&overlay, &break_line_widgets, &pagination.break_points_buffer_y());
                    }
                ),
            );
        }
    ));

    open_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[weak]
        buffer,
        #[weak]
        title_widget,
        #[strong]
        state,
        move |_| {
            let dialog = gtk::FileDialog::builder()
                .title("Abrir documento")
                .modal(true)
                .build();
            let filters = gio::ListStore::new::<gtk::FileFilter>();
            filters.append(&prosa_file_filter());
            filters.append(&docx_file_filter());
            filters.append(&odt_file_filter());
            filters.append(&rtf_file_filter());
            dialog.set_filters(Some(&filters));

            glib::spawn_future_local(glib::clone!(
                #[weak]
                window,
                #[weak]
                buffer,
                #[weak]
                title_widget,
                #[strong]
                state,
                async move {
                    let file = match dialog.open_future(Some(&window)).await {
                        Ok(file) => file,
                        Err(_) => return, // cancelado pelo usuário
                    };
                    let Some(path) = file.path() else { return };
                    let extension =
                        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();

                    let opened = match extension.as_str() {
                        "docx" | "odt" | "rtf" => read_foreign_document(&path, &extension).map(|content| {
                            let now = now_iso();
                            let metadata = DocumentMetadata {
                                title: file_stem_title(&path),
                                author: String::new(),
                                created_at: now.clone(),
                                modified_at: now,
                            };
                            (content, metadata, None, None)
                        }),
                        _ => ProsaFile::load(&path).map_err(|e| e.to_string()).map(|f| (f.content, f.metadata, f.header, f.footer)),
                    };

                    match opened {
                        Ok((content, metadata, header, footer)) => {
                            load_doc_into_buffer(&buffer, &content);
                            title_widget.set_subtitle(&metadata.title);
                            *state.borrow_mut() = DocumentState { path: Some(path), metadata, header, footer };
                        }
                        Err(message) => {
                            let alert = adw::AlertDialog::new(Some("Não foi possível abrir o documento"), Some(&message));
                            alert.add_response("ok", "OK");
                            alert.present(Some(&window));
                        }
                    }
                }
            ));
        }
    ));

    save_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[weak]
        buffer,
        #[weak]
        title_widget,
        #[strong]
        state,
        move |_| {
            let existing_path = state.borrow().path.clone();

            let finish_save = glib::clone!(
                #[weak]
                window,
                #[weak]
                buffer,
                #[weak]
                title_widget,
                #[strong]
                state,
                move |path: PathBuf| {
                    let mut current = state.borrow_mut();
                    current.metadata.modified_at = now_iso();
                    let prosa_file = ProsaFile {
                        version: 1,
                        content: doc_from_buffer(&buffer),
                        metadata: current.metadata.clone(),
                        notes: None,
                        header: current.header.clone(),
                        footer: current.footer.clone(),
                    };
                    match prosa_file.save(&path) {
                        Ok(()) => {
                            title_widget.set_subtitle(&current.metadata.title);
                            current.path = Some(path);
                        }
                        Err(err) => {
                            drop(current);
                            let alert = adw::AlertDialog::new(
                                Some("Não foi possível salvar o documento"),
                                Some(&err.to_string()),
                            );
                            alert.add_response("ok", "OK");
                            alert.present(Some(&window));
                        }
                    }
                }
            );

            if let Some(path) = existing_path {
                finish_save(path);
                return;
            }

            let dialog = gtk::FileDialog::builder()
                .title("Salvar documento Prosa")
                .modal(true)
                .initial_name("Sem título.prosa")
                .build();
            let filters = gio::ListStore::new::<gtk::FileFilter>();
            filters.append(&prosa_file_filter());
            dialog.set_filters(Some(&filters));

            glib::spawn_future_local(glib::clone!(
                #[weak]
                window,
                async move {
                    if let Ok(file) = dialog.save_future(Some(&window)).await {
                        if let Some(path) = file.path() {
                            finish_save(path);
                        }
                    }
                }
            ));
        }
    ));

    export_pdf_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[weak]
        buffer,
        #[strong]
        state,
        move |_| {
            let default_name = format!("{}.pdf", state.borrow().metadata.title);
            let dialog = gtk::FileDialog::builder()
                .title("Exportar PDF")
                .modal(true)
                .initial_name(default_name)
                .build();
            let filters = gio::ListStore::new::<gtk::FileFilter>();
            let pdf_filter = gtk::FileFilter::new();
            pdf_filter.set_name(Some("PDF"));
            pdf_filter.add_suffix("pdf");
            filters.append(&pdf_filter);
            dialog.set_filters(Some(&filters));

            glib::spawn_future_local(glib::clone!(
                #[weak]
                window,
                #[weak]
                buffer,
                #[strong]
                state,
                async move {
                    let Ok(file) = dialog.save_future(Some(&window)).await else { return };
                    let Some(path) = file.path() else { return };

                    let doc = doc_from_buffer(&buffer);
                    let current = state.borrow();
                    let result = print::export_to_pdf(
                        &window,
                        &path,
                        &doc,
                        current.header.as_deref(),
                        current.footer.as_deref(),
                    );
                    drop(current);

                    if let Err(err) = result {
                        let alert = adw::AlertDialog::new(
                            Some("Não foi possível exportar o PDF"),
                            Some(&err.to_string()),
                        );
                        alert.add_response("ok", "OK");
                        alert.present(Some(&window));
                    }
                }
            ));
        }
    ));

    for (action_name, format_label, extension, filter, write_fn) in [
        (
            "export-docx",
            "Word (.docx)",
            "docx",
            docx_file_filter(),
            Rc::new(|doc: &prosa_doc::TipTapNode| docx::write_docx(doc).map_err(|e| e.to_string()))
                as Rc<dyn Fn(&prosa_doc::TipTapNode) -> Result<Vec<u8>, String>>,
        ),
        (
            "export-odt",
            "OpenDocument (.odt)",
            "odt",
            odt_file_filter(),
            Rc::new(|doc: &prosa_doc::TipTapNode| odt::write_odt(doc).map_err(|e| e.to_string())),
        ),
        (
            "export-rtf",
            "Rich Text (.rtf)",
            "rtf",
            rtf_file_filter(),
            Rc::new(|doc: &prosa_doc::TipTapNode| Ok(rtf::write_rtf(doc))),
        ),
    ] {
        let action = gio::SimpleAction::new(action_name, None);
        action.connect_activate(glib::clone!(
            #[weak]
            window,
            #[weak]
            buffer,
            #[strong]
            state,
            move |_, _| {
                spawn_export(window.clone(), buffer.clone(), state.clone(), format_label, extension, filter.clone(), write_fn.clone());
            }
        ));
        window.add_action(&action);
    }

    let ai_settings_action = gio::SimpleAction::new("ai-settings", None);
    ai_settings_action.connect_activate(glib::clone!(
        #[weak]
        window,
        #[strong]
        ai_provider,
        move |_, _| ai_ui::open_settings_dialog(&window, &ai_provider)
    ));
    window.add_action(&ai_settings_action);

    for index in 0..ai_ui::ACTIONS_MENU.len() {
        let action = gio::SimpleAction::new(&format!("ai-action-{index}"), None);
        action.connect_activate(glib::clone!(
            #[weak]
            window,
            #[weak]
            buffer,
            #[strong]
            ai_provider,
            move |_, _| {
                let (_, ai_action) = ai_ui::ACTIONS_MENU[index];
                ai_ui::run_action(&window, &buffer, ai_provider.get(), ai_action);
            }
        ));
        window.add_action(&action);
    }

    window.present();
}

/// Diálogo de "salvar como" + escrita do documento num formato de
/// exportação (docx/odt/rtf), compartilhado pelas três ações de menu.
fn spawn_export(
    window: adw::ApplicationWindow,
    buffer: gtk::TextBuffer,
    state: Rc<RefCell<DocumentState>>,
    format_label: &'static str,
    extension: &'static str,
    filter: gtk::FileFilter,
    write_fn: Rc<dyn Fn(&prosa_doc::TipTapNode) -> Result<Vec<u8>, String>>,
) {
    let default_name = format!("{}.{extension}", state.borrow().metadata.title);
    let dialog = gtk::FileDialog::builder()
        .title(format!("Exportar {format_label}"))
        .modal(true)
        .initial_name(default_name)
        .build();
    let filters = gio::ListStore::new::<gtk::FileFilter>();
    filters.append(&filter);
    dialog.set_filters(Some(&filters));

    glib::spawn_future_local(glib::clone!(
        #[weak]
        window,
        #[weak]
        buffer,
        async move {
            let Ok(file) = dialog.save_future(Some(&window)).await else { return };
            let Some(path) = file.path() else { return };

            let doc = doc_from_buffer(&buffer);
            let result = write_fn(&doc).and_then(|bytes| std::fs::write(&path, bytes).map_err(|e| e.to_string()));

            if let Err(message) = result {
                let alert =
                    adw::AlertDialog::new(Some(&format!("Não foi possível exportar como {format_label}")), Some(&message));
                alert.add_response("ok", "OK");
                alert.present(Some(&window));
            }
        }
    ));
}

/// Por padrão, libadwaita já segue claro/escuro do sistema (via portal
/// freedesktop). Se não der pra identificar nenhuma DE, força escuro em vez
/// de cair no claro (fallback do próprio GTK quando o portal não existe).
fn apply_theme_fallback() {
    let has_known_desktop = std::env::var("XDG_CURRENT_DESKTOP").is_ok_and(|v| !v.is_empty())
        || std::env::var("DESKTOP_SESSION").is_ok_and(|v| !v.is_empty());
    if !has_known_desktop {
        adw::StyleManager::default().set_color_scheme(adw::ColorScheme::ForceDark);
    }
}

fn main() -> glib::ExitCode {
    let app = adw::Application::builder().application_id(APP_ID).build();
    app.connect_activate(|app| {
        apply_theme_fallback();
        build_window(app);
    });
    app.run()
}

/// GTK só aceita ser inicializado numa única thread do processo, mas o
/// harness padrão do Rust roda cada `#[test]` em sua própria thread — por
/// isso todos os testes que tocam GTK (deste e dos outros módulos) são
/// chamados a partir deste único `#[test]`, em vez de terem o atributo cada
/// um no seu módulo.
#[cfg(test)]
mod tests {
    #[test]
    fn all_gtk_dependent_tests() {
        let _ = gtk::init();
        crate::formatting::tests::round_trip_preserves_marks();
        crate::formatting::tests::multiple_paragraphs_round_trip();
        crate::formatting::tests::toggle_mark_applies_and_removes();
        crate::print::tests::page_breaks_split_when_content_overflows();
        crate::print::tests::export_produces_multi_page_pdf_with_pagination();
        crate::find_replace::tests::search_finds_all_occurrences_with_accented_text();
        crate::find_replace::tests::navigation_wraps_around_circularly();
        crate::find_replace::tests::replace_current_only_changes_the_current_match();
        crate::find_replace::tests::replace_all_handles_different_length_replacement_without_corruption();
        crate::find_replace::tests::clear_removes_highlights_and_resets_state();
    }
}
