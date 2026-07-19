//! Diálogo "Novo documento": escolher um template pronto ou começar em
//! branco — espelha `DocumentTemplateDialog` do Electron (grade de
//! cartões com "Em branco" + os templates), usando o padrão de diálogo já
//! estabelecido no app nativo (`AdwAlertDialog` + `extra_child`) em vez do
//! modal HTML customizado do original.

use adw::prelude::*;
use prosa_doc::templates::{document_templates, DocumentTemplate};

/// Mostra o diálogo; chama `on_choice` com o template escolhido, ou `None`
/// para "Em branco". Não chama nada se o usuário cancelar.
pub fn show_template_picker(window: &adw::ApplicationWindow, on_choice: impl Fn(Option<DocumentTemplate>) + 'static) {
    let templates = document_templates();

    let list = gtk::ListBox::new();
    list.add_css_class("boxed-list");
    list.set_selection_mode(gtk::SelectionMode::None);

    let blank_row = gtk::Label::builder()
        .label("Em branco\nDocumento novo, sem estrutura pré-definida.")
        .xalign(0.0)
        .wrap(true)
        .margin_start(8)
        .margin_end(8)
        .margin_top(8)
        .margin_bottom(8)
        .build();
    list.append(&blank_row);

    for template in &templates {
        let label = gtk::Label::builder()
            .label(format!("{}\n{} · {}", template.name, template.category.label(), template.description))
            .xalign(0.0)
            .wrap(true)
            .margin_start(8)
            .margin_end(8)
            .margin_top(8)
            .margin_bottom(8)
            .build();
        list.append(&label);
    }

    let scrolled = gtk::ScrolledWindow::builder().child(&list).min_content_height(320).build();
    let dialog = adw::AlertDialog::builder().heading("Novo documento").body("Escolha um template ou comece em branco:").extra_child(&scrolled).build();
    dialog.add_response("cancel", "Cancelar");
    dialog.set_close_response("cancel");
    dialog.present(Some(window));

    list.connect_row_activated(glib::clone!(
        #[weak]
        dialog,
        move |_, row| {
            let index = row.index();
            if index == 0 {
                on_choice(None);
            } else if let Some(template) = templates.get((index - 1) as usize) {
                on_choice(Some(template.clone()));
            }
            dialog.force_close();
        }
    ));
}
