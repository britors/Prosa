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

fn build_window(app: &adw::Application) {
    let text_view = gtk::TextView::builder()
        .wrap_mode(gtk::WrapMode::Word)
        .top_margin(24)
        .bottom_margin(24)
        .left_margin(96)
        .right_margin(96)
        .build();
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
    open_button.set_tooltip_text(Some("Abrir (.prosa)"));
    let save_button = gtk::Button::from_icon_name("document-save-symbolic");
    save_button.set_tooltip_text(Some("Salvar"));

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

    let header_bar = adw::HeaderBar::builder().title_widget(&title_widget).build();
    header_bar.pack_start(&open_button);
    header_bar.pack_start(&save_button);
    header_bar.pack_start(&gtk::Separator::new(gtk::Orientation::Vertical));
    header_bar.pack_start(&bold_button);
    header_bar.pack_start(&italic_button);
    header_bar.pack_start(&underline_button);
    header_bar.pack_start(&strike_button);
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
                .title("Abrir documento Prosa")
                .modal(true)
                .build();
            let filters = gio::ListStore::new::<gtk::FileFilter>();
            filters.append(&prosa_file_filter());
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
                    match ProsaFile::load(&path) {
                        Ok(prosa_file) => {
                            load_doc_into_buffer(&buffer, &prosa_file.content);
                            title_widget.set_subtitle(&prosa_file.metadata.title);
                            *state.borrow_mut() = DocumentState {
                                path: Some(path),
                                metadata: prosa_file.metadata,
                                header: prosa_file.header,
                                footer: prosa_file.footer,
                            };
                        }
                        Err(err) => {
                            let alert = adw::AlertDialog::new(
                                Some("Não foi possível abrir o documento"),
                                Some(&err.to_string()),
                            );
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

    window.present();
}

fn main() -> glib::ExitCode {
    let app = adw::Application::builder().application_id(APP_ID).build();
    app.connect_activate(build_window);
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
