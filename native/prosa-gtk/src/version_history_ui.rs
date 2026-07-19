//! Diálogo de histórico de versões: lista de snapshots automáticos (ver
//! `prosa_doc::version_history`), diff por linha contra o documento atual
//! em edição, e restauração.
//!
//! O Electron original (`version-compare-dialog.ts`) só tinha um
//! visualizador de diff somente-leitura, em grid de duas colunas, aberto
//! pela paleta de comandos — sem nenhum jeito de voltar a uma versão
//! antiga. Aqui o diff é renderizado como texto unificado (`+`/`-`/` ` por
//! linha, com cor de fundo) num único `GtkTextView`, mais simples de manter
//! que duas colunas com rolagem sincronizada, e ganhou um botão "Restaurar"
//! — funcionalidade nova, não uma lacuna herdada do original.
//!
//! Segue o mesmo padrão `AdwAlertDialog` + `extra_child` já usado em
//! `bibliography_ui`/`ai_ui::open_settings_dialog`.

use std::path::PathBuf;
use std::rc::Rc;

use adw::prelude::*;
use gtk::gdk;
use prosa_doc::version_history::{self, BackupVersion, DiffRowKind};
use prosa_doc::ProsaFile;

use crate::formatting::doc_from_buffer;

fn format_timestamp(iso: &str) -> String {
    glib::DateTime::from_iso8601(iso, None)
        .and_then(|dt| dt.to_local())
        .and_then(|dt| dt.format("%d/%m/%Y %H:%M:%S"))
        .map(|s| s.to_string())
        .unwrap_or_else(|_| iso.to_string())
}

fn setup_diff_tags(buffer: &gtk::TextBuffer) {
    let table = buffer.tag_table();
    if table.lookup("diff-added").is_some() {
        return;
    }
    table.add(&gtk::TextTag::builder().name("diff-added").background_rgba(&gdk::RGBA::new(0.11, 0.6, 0.2, 0.35)).family("monospace").build());
    table.add(&gtk::TextTag::builder().name("diff-removed").background_rgba(&gdk::RGBA::new(0.85, 0.15, 0.15, 0.3)).family("monospace").build());
    table.add(&gtk::TextTag::builder().name("diff-same").family("monospace").build());
}

/// Renderiza o diff unificado entre `old_text` (versão antiga, à esquerda
/// conceitualmente) e `new_text` (documento atual) no buffer somente-leitura
/// do diálogo.
fn render_diff(diff_buffer: &gtk::TextBuffer, old_text: &str, new_text: &str) {
    diff_buffer.set_text("");
    let rows = version_history::diff_lines(old_text, new_text);
    let mut end = diff_buffer.end_iter();
    for row in rows {
        let (prefix, tag) = match row.kind {
            DiffRowKind::Same => ("  ", "diff-same"),
            DiffRowKind::Removed => ("- ", "diff-removed"),
            DiffRowKind::Added => ("+ ", "diff-added"),
        };
        let line = format!("{prefix}{}\n", row.text);
        let start_offset = end.offset();
        diff_buffer.insert(&mut end, &line);
        let start = diff_buffer.iter_at_offset(start_offset);
        let line_end = diff_buffer.iter_at_offset(end.offset());
        diff_buffer.apply_tag_by_name(tag, &start, &line_end);
        end = diff_buffer.end_iter();
    }
}

/// Abre o diálogo de histórico de versões para `path`. Sem caminho ainda
/// (documento nunca salvo), mostra o mesmo estado vazio do original:
/// "Salve o documento para comparar versões."
pub fn open_version_history_dialog(window: &adw::ApplicationWindow, buffer: &gtk::TextBuffer, path: Option<PathBuf>, on_restore: Rc<dyn Fn(ProsaFile)>) {
    let Some(path) = path else {
        let alert = adw::AlertDialog::new(Some("Nenhum histórico ainda"), Some("Salve o documento para ver o histórico de versões."));
        alert.add_response("ok", "OK");
        alert.present(Some(window));
        return;
    };

    let versions: Vec<BackupVersion> = version_history::list_versions(&path);
    if versions.is_empty() {
        let alert = adw::AlertDialog::new(Some("Nenhuma versão anterior"), Some("Nenhuma versão anterior encontrada. Versões são criadas automaticamente a cada vez que você salva."));
        alert.add_response("ok", "OK");
        alert.present(Some(window));
        return;
    }

    let labels: Vec<String> = versions.iter().map(|v| format_timestamp(&v.modified_at)).collect();
    let label_refs: Vec<&str> = labels.iter().map(String::as_str).collect();
    let version_model = gtk::StringList::new(&label_refs);
    let version_dropdown = gtk::DropDown::new(Some(version_model), gtk::Expression::NONE);

    let diff_view = gtk::TextView::builder().editable(false).cursor_visible(false).monospace(true).wrap_mode(gtk::WrapMode::WordChar).build();
    let diff_buffer = diff_view.buffer();
    setup_diff_tags(&diff_buffer);
    let diff_scrolled = gtk::ScrolledWindow::builder().child(&diff_view).min_content_height(320).vexpand(true).build();

    let restore_button = gtk::Button::with_label("Restaurar esta versão");
    let status_label = gtk::Label::builder().xalign(0.0).css_classes(["dim-label"]).wrap(true).build();

    let versions = Rc::new(versions);
    let refresh_diff = glib::clone!(
        #[weak]
        diff_buffer,
        #[weak]
        buffer,
        #[strong]
        versions,
        #[weak]
        version_dropdown,
        #[strong]
        path,
        move || {
            let index = version_dropdown.selected() as usize;
            let Some(version) = versions.get(index) else { return };
            let Some(old_file) = version_history::read_version(&path, &version.file) else { return };
            let old_text = old_file.content.plain_text();
            let new_text = doc_from_buffer(&buffer).plain_text();
            render_diff(&diff_buffer, &old_text, &new_text);
        }
    );
    refresh_diff();

    version_dropdown.connect_selected_notify(glib::clone!(
        #[strong]
        refresh_diff,
        move |_| refresh_diff()
    ));

    let content = gtk::Box::builder().orientation(gtk::Orientation::Vertical).spacing(8).build();
    let version_row = gtk::Box::builder().orientation(gtk::Orientation::Horizontal).spacing(8).build();
    version_row.append(&gtk::Label::builder().label("Versão:").build());
    version_row.append(&version_dropdown);
    content.append(&version_row);
    content.append(&gtk::Label::builder().label("Comparado com o documento atual (linhas removidas em vermelho, adicionadas em verde):").xalign(0.0).css_classes(["dim-label"]).wrap(true).build());
    content.append(&diff_scrolled);
    content.append(&status_label);
    content.append(&restore_button);

    let dialog = adw::AlertDialog::builder().heading("Histórico de versões").extra_child(&content).build();
    dialog.add_response("close", "Fechar");
    dialog.set_close_response("close");
    dialog.present(Some(window));

    restore_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[weak]
        version_dropdown,
        #[strong]
        versions,
        #[strong]
        path,
        #[strong]
        on_restore,
        #[weak]
        status_label,
        #[weak]
        dialog,
        move |_| {
            let index = version_dropdown.selected() as usize;
            let Some(version) = versions.get(index) else { return };
            let Some(label) = version_dropdown.model().and_then(|m| m.downcast::<gtk::StringList>().ok()).and_then(|m| m.string(index as u32)) else {
                return;
            };

            let confirm = adw::AlertDialog::new(
                Some("Restaurar esta versão?"),
                Some(&format!("O conteúdo atual do editor será substituído pela versão de {label}. Uma cópia de segurança do estado atual é salva automaticamente antes.")),
            );
            confirm.add_response("cancel", "Cancelar");
            confirm.add_response("restore", "Restaurar");
            confirm.set_response_appearance("restore", adw::ResponseAppearance::Destructive);
            confirm.set_close_response("cancel");

            let file_name = version.file.clone();
            confirm.connect_response(
                None,
                glib::clone!(
                    #[strong]
                    path,
                    #[strong]
                    on_restore,
                    #[weak]
                    status_label,
                    #[weak]
                    dialog,
                    move |_, response| {
                        if response != "restore" {
                            return;
                        }
                        match version_history::read_version(&path, &file_name) {
                            Some(prosa_file) => {
                                on_restore(prosa_file);
                                dialog.close();
                            }
                            None => status_label.set_text("Não foi possível ler essa versão."),
                        }
                    }
                ),
            );
            confirm.present(Some(&window));
        }
    ));
}
