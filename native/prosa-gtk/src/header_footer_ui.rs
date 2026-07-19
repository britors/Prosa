//! Diálogo de edição de cabeçalho/rodapé: texto simples, repetido em toda
//! página (na pré-visualização ao vivo e na exportação de PDF — ver
//! `sync_page_bands`/`print::export_to_pdf`, ambos lendo os mesmos campos
//! `header`/`footer` do documento). A numeração de página ("Página N de
//! Total") é sempre adicionada automaticamente ao final do rodapé; não faz
//! parte do texto editável aqui.
//!
//! Mesmo padrão `AdwAlertDialog` + `extra_child` já usado em
//! `bibliography_ui`/`ai_ui::open_settings_dialog`/`version_history_ui`.

use adw::prelude::*;

/// Abre o diálogo, pré-preenchido com `current_header`/`current_footer`.
/// `on_saved` só é chamado se o usuário confirmar ("Salvar") — recebe os
/// novos valores (`None` se o campo ficou vazio).
pub fn open_dialog(
    window: &adw::ApplicationWindow,
    current_header: Option<&str>,
    current_footer: Option<&str>,
    on_saved: impl Fn(Option<String>, Option<String>) + 'static,
) {
    let header_entry = gtk::Entry::builder().text(current_header.unwrap_or("")).placeholder_text("Ex.: nome do documento").build();
    let footer_entry = gtk::Entry::builder().text(current_footer.unwrap_or("")).placeholder_text("Ex.: Confidencial").build();

    let content = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(8).build();
    content.append(&gtk::Label::builder().label("Cabeçalho").xalign(0.0).build());
    content.append(&header_entry);
    content.append(&gtk::Label::builder().label("Rodapé").xalign(0.0).build());
    content.append(&footer_entry);

    let dialog = adw::AlertDialog::builder()
        .heading("Cabeçalho e rodapé")
        .body("Repetidos em toda página, no editor e na exportação para PDF. A numeração de página é adicionada automaticamente ao final do rodapé.")
        .extra_child(&content)
        .build();
    dialog.add_response("cancel", "Cancelar");
    dialog.add_response("save", "Salvar");
    dialog.set_response_appearance("save", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("save"));
    dialog.set_close_response("cancel");

    dialog.connect_response(
        None,
        glib::clone!(
            #[weak]
            header_entry,
            #[weak]
            footer_entry,
            move |_dialog, response| {
                if response != "save" {
                    return;
                }
                let header = header_entry.text().to_string();
                let footer = footer_entry.text().to_string();
                on_saved(if header.is_empty() { None } else { Some(header) }, if footer.is_empty() { None } else { Some(footer) });
            }
        ),
    );

    dialog.present(Some(window));
}
