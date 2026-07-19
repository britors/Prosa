//! Diálogo de configuração da pasta de sincronização (`sync_watcher`).
//!
//! Pasta session-only, igual ao workspace root do painel de backlinks (ver
//! `main.rs::BacklinksPanel`) — mas é uma pasta *diferente*, conceito à
//! parte no Electron (`settings.syncPath`, não `workspacePath`): destinada
//! a serviços de sincronização externos (Dropbox/Drive), não ao escaneio de
//! wikilinks/bibliografia.

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use adw::prelude::*;

fn status_text(root: Option<&PathBuf>) -> String {
    match root {
        Some(path) => format!("Observando: {}", path.display()),
        None => "Sincronização desativada.".to_string(),
    }
}

/// Abre o diálogo. `on_change` é chamado com a nova pasta (ou `None`, se
/// desativada) toda vez que o usuário escolhe ou desativa — quem chama
/// (`main.rs`) usa isso pra reiniciar o `sync_watcher::Watcher` de verdade.
pub fn open_sync_settings_dialog(window: &adw::ApplicationWindow, sync_root: &Rc<RefCell<Option<PathBuf>>>, on_change: Rc<dyn Fn(Option<PathBuf>)>) {
    let status_label = gtk::Label::builder().xalign(0.0).wrap(true).css_classes(["dim-label"]).build();
    status_label.set_text(&status_text(sync_root.borrow().as_ref()));

    let choose_button = gtk::Button::with_label("Escolher pasta...");
    let disable_button = gtk::Button::with_label("Desativar sincronização");
    disable_button.set_sensitive(sync_root.borrow().is_some());

    let content = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(8).build();
    content.append(&gtk::Label::builder().label("Uma pasta observada por um serviço de sincronização externo (Dropbox, Drive, etc). Ao detectar que o documento aberto mudou por fora do Prosa, um aviso oferece recarregar.").xalign(0.0).wrap(true).css_classes(["dim-label"]).build());
    content.append(&status_label);
    let buttons_row = gtk::Box::builder().orientation(gtk::Orientation::Horizontal).spacing(8).homogeneous(true).build();
    buttons_row.append(&choose_button);
    buttons_row.append(&disable_button);
    content.append(&buttons_row);

    let dialog = adw::AlertDialog::builder().heading("Sincronização").extra_child(&content).build();
    dialog.add_response("close", "Fechar");
    dialog.set_close_response("close");
    dialog.present(Some(window));

    choose_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[strong]
        sync_root,
        #[strong]
        on_change,
        #[weak]
        status_label,
        #[weak]
        disable_button,
        move |_| {
            let file_dialog = gtk::FileDialog::builder().title("Escolher pasta de sincronização").modal(true).build();
            glib::spawn_future_local(glib::clone!(
                #[weak]
                window,
                #[strong]
                sync_root,
                #[strong]
                on_change,
                #[weak]
                status_label,
                #[weak]
                disable_button,
                async move {
                    let Ok(folder) = file_dialog.select_folder_future(Some(&window)).await else { return };
                    let Some(path) = folder.path() else { return };
                    *sync_root.borrow_mut() = Some(path.clone());
                    status_label.set_text(&status_text(Some(&path)));
                    disable_button.set_sensitive(true);
                    on_change(Some(path));
                }
            ));
        }
    ));

    disable_button.connect_clicked(glib::clone!(
        #[strong]
        sync_root,
        #[strong]
        on_change,
        #[weak]
        status_label,
        #[weak]
        disable_button,
        move |_| {
            *sync_root.borrow_mut() = None;
            status_label.set_text(&status_text(None));
            disable_button.set_sensitive(false);
            on_change(None);
        }
    ));
}
