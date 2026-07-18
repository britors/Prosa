//! Prosa nativo — casca GTK4 + libadwaita (MVP).
//!
//! Cobre o escopo do MVP da migração: shell nativo, editor de texto simples
//! sobre `GtkTextView` (com negrito/itálico/sublinhado/tachado) e abrir/salvar
//! o formato `.prosa` existente. Sem paginação, tabelas, imagens ou estrutura
//! de bloco (títulos) ainda — isso é trabalho das fases seguintes (ver issues
//! da epic "Migração do Prosa para Rust + GTK4").

mod formatting;
mod print;

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, gio, glib};
use prosa_doc::{docx, odt, rtf};
use prosa_doc::{DocumentMetadata, ProsaFile};

use formatting::{doc_from_buffer, load_doc_into_buffer, setup_mark_tags, toggle_mark};

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

/// A "folha" é sempre branca (papel), como no restante do app — só a
/// janela/botões ao redor seguem o tema claro/escuro do sistema.
fn install_page_css() {
    let provider = gtk::CssProvider::new();
    provider.load_from_string(
        "textview.prosa-page, textview.prosa-page text { background-color: #ffffff; color: #1a1a1a; }",
    );
    if let Some(display) = gtk::gdk::Display::default() {
        gtk::style_context_add_provider_for_display(&display, &provider, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);
    }
}

fn build_window(app: &adw::Application) {
    install_page_css();

    let text_view = gtk::TextView::builder()
        .wrap_mode(gtk::WrapMode::Word)
        .top_margin(24)
        .bottom_margin(24)
        .left_margin(96)
        .right_margin(96)
        .build();
    text_view.add_css_class("prosa-page");
    let buffer = text_view.buffer();
    setup_mark_tags(&buffer);

    let scrolled = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Never)
        .child(&text_view)
        .vexpand(true)
        .build();

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
    header_bar.pack_end(&export_menu_button);
    header_bar.pack_end(&export_pdf_button);

    let toolbar_view = adw::ToolbarView::new();
    toolbar_view.add_top_bar(&header_bar);
    toolbar_view.set_content(Some(&scrolled));

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
        #[upgrade_or]
        glib::Propagation::Proceed,
        move |_, keyval, _keycode, modifiers| {
            if modifiers.contains(gdk::ModifierType::CONTROL_MASK) {
                let lower = keyval.to_lower();
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
    }
}
