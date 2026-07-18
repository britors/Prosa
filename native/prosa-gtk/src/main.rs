//! Prosa nativo — casca GTK4 + libadwaita (MVP).
//!
//! Cobre o escopo do MVP da migração: shell nativo, editor de texto simples
//! sobre `GtkTextView` e abrir/salvar o formato `.prosa` existente. Sem
//! paginação, tabelas, imagens ou formatação rica ainda — isso é trabalho das
//! fases seguintes (ver issues da epic "Migração do Prosa para Rust + GTK4").

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use adw::prelude::*;
use gtk::{gio, glib};
use prosa_doc::{DocumentMetadata, ProsaFile, TipTapNode};

const APP_ID: &str = "br.com.rodrigobrito.Prosa.Native";

/// Estado do documento atualmente aberto na janela.
struct DocumentState {
    path: Option<PathBuf>,
    metadata: DocumentMetadata,
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

    let header_bar = adw::HeaderBar::builder().title_widget(&title_widget).build();
    header_bar.pack_start(&open_button);
    header_bar.pack_start(&save_button);

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
                            buffer.set_text(&prosa_file.content.plain_text());
                            title_widget.set_subtitle(&prosa_file.metadata.title);
                            *state.borrow_mut() = DocumentState {
                                path: Some(path),
                                metadata: prosa_file.metadata,
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
            let (start, end) = buffer.bounds();
            let text = buffer.text(&start, &end, false).to_string();

            let existing_path = state.borrow().path.clone();

            let finish_save = glib::clone!(
                #[weak]
                title_widget,
                #[strong]
                state,
                #[weak]
                window,
                move |path: PathBuf, text: String| {
                    let mut current = state.borrow_mut();
                    current.metadata.modified_at = now_iso();
                    let prosa_file = ProsaFile {
                        version: 1,
                        content: TipTapNode::doc_from_plain_text(&text),
                        metadata: current.metadata.clone(),
                        notes: None,
                        header: None,
                        footer: None,
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
                finish_save(path, text);
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
                            finish_save(path, text);
                        }
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
