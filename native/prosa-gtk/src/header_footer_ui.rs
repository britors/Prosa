//! Diálogo de edição do cabeçalho e rodapé repetidos.

use adw::prelude::*;

pub fn open_dialog(
    window: &adw::ApplicationWindow,
    current_header: Option<&str>,
    current_footer: Option<&str>,
    on_saved: impl Fn(Option<String>, Option<String>) + 'static,
) {
    let header_entry = gtk::Entry::builder().text(current_header.unwrap_or_default()).build();
    let footer_entry = gtk::Entry::builder().text(current_footer.unwrap_or_default()).build();

    let content = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(8).build();
    content.append(&gtk::Label::builder().label("Cabeçalho").xalign(0.0).build());
    content.append(&header_entry);
    content.append(&gtk::Label::builder().label("Rodapé").xalign(0.0).build());
    content.append(&footer_entry);

    let dialog = adw::AlertDialog::builder()
        .heading("Cabeçalho e rodapé")
        .body("O conteúdo é repetido em todas as páginas. A numeração é automática.")
        .extra_child(&content)
        .build();
    dialog.add_response("cancel", "Cancelar");
    dialog.add_response("save", "Salvar");
    dialog.set_response_appearance("save", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("save"));
    dialog.set_close_response("cancel");
    dialog.connect_response(None, move |_, response| {
        if response != "save" {
            return;
        }
        let value = |entry: &gtk::Entry| {
            let text = entry.text().trim().to_string();
            (!text.is_empty()).then_some(text)
        };
        on_saved(value(&header_entry), value(&footer_entry));
    });
    dialog.present(Some(window));
}
