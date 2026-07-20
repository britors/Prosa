//! Checagem de atualização (ver `prosa_doc::update_check`) exposta na UI via
//! toast — sem download/instalação automáticos: o botão do toast só abre a
//! página da release no navegador, e o usuário atualiza do jeito que já
//! instalou (gerenciador de pacotes no Linux, `.zip` no Windows).

use gtk::glib;
use prosa_doc::update_check::{self, UpdateInfo};

/// Dispara a checagem de atualização numa thread separada (rede é
/// bloqueante) e mostra o resultado num toast, seguindo o mesmo padrão de
/// `ai_ui::run_action`: thread + canal `mpsc` + `glib::idle_add_local`
/// polling a partir da thread principal do GTK.
///
/// `notify_up_to_date` controla se um toast também aparece quando já se está
/// na versão mais recente — usado na checagem manual (botão da toolbar), mas
/// não na automática de abertura do app, pra não incomodar o usuário à toa.
pub fn check_for_updates(toast_overlay: &adw::ToastOverlay, notify_up_to_date: bool) {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let outcome = update_check::check_for_update(env!("CARGO_PKG_VERSION"));
        let _ = tx.send(outcome);
    });

    glib::idle_add_local(glib::clone!(
        #[weak]
        toast_overlay,
        #[upgrade_or]
        glib::ControlFlow::Break,
        move || match rx.try_recv() {
            Ok(Ok(Some(info))) => {
                show_update_available_toast(&toast_overlay, &info);
                glib::ControlFlow::Break
            }
            Ok(Ok(None)) => {
                if notify_up_to_date {
                    toast_overlay.add_toast(adw::Toast::new("Você já está usando a versão mais recente do Prosa."));
                }
                glib::ControlFlow::Break
            }
            // Falha de rede/GitHub: fica em silêncio, mesmo espírito de
            // degradação graciosa do resto do app (spellcheck sem
            // dicionário, keyring sem entrada etc.) — checar atualização
            // nunca deve travar nem irritar o usuário.
            Ok(Err(_)) => glib::ControlFlow::Break,
            Err(std::sync::mpsc::TryRecvError::Empty) => glib::ControlFlow::Continue,
            Err(std::sync::mpsc::TryRecvError::Disconnected) => glib::ControlFlow::Break,
        }
    ));
}

fn show_update_available_toast(toast_overlay: &adw::ToastOverlay, info: &UpdateInfo) {
    let toast = adw::Toast::new(&format!("Nova versão do Prosa disponível: {}", info.version));
    toast.set_button_label(Some("Baixar"));
    toast.set_timeout(0);

    let html_url = info.html_url.clone();
    toast.connect_button_clicked(move |_| {
        let _ = gtk::gio::AppInfo::launch_default_for_uri(&html_url, gtk::gio::AppLaunchContext::NONE);
    });

    toast_overlay.add_toast(toast);
}
