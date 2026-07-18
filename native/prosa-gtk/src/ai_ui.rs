//! Integração de IA na UI: diálogo de configuração (provedor + chave) e
//! disparo das ações de escrita assistida sobre a seleção atual do buffer
//! (ou o documento inteiro, se nada estiver selecionado).
//!
//! As chamadas HTTP (`prosa_doc::ai`) são bloqueantes — rodam numa thread
//! separada (`std::thread::spawn`) pra não travar a interface, e o
//! resultado volta pra thread principal do GTK via `glib::idle_add_once`
//! (mais simples que um canal `MainContext`, e não exige um runtime tokio
//! próprio: `reqwest::blocking` já cuida disso internamente).
//!
//! Escopo do MVP: seis ações comuns (as citadas na descrição do app —
//! revisar, resumir, expandir, traduzir, reorganizar — mais "melhorar
//! clareza"). O backend (`prosa_doc::ai::AiWritingAction`) já cobre as 35
//! ações da versão Electron; adicionar mais aqui é só questão de estender
//! `ACTIONS_MENU`. Traduzir/mudar tom usam os padrões (português do Brasil/
//! formal) — sem seletor de idioma/tom ainda.

use std::cell::Cell;
use std::rc::Rc;

use adw::prelude::*;
use gtk::glib;
use prosa_doc::ai::{self, AiProvider, AiWritingAction, AiWritingRequest};

/// Rótulo (para menu/dropdown) de cada provedor, na mesma ordem de
/// `AiProvider::ALL`.
const PROVIDER_LABELS: [(&str, AiProvider); 6] = [
    ("OpenAI", AiProvider::OpenAi),
    ("Google Gemini", AiProvider::Gemini),
    ("Anthropic Claude", AiProvider::Anthropic),
    ("Mistral", AiProvider::Mistral),
    ("Groq", AiProvider::Groq),
    ("Cohere", AiProvider::Cohere),
];

/// Ações oferecidas no menu "IA" da UI (rótulo, ação).
pub const ACTIONS_MENU: [(&str, AiWritingAction); 6] = [
    ("Revisar", AiWritingAction::Review),
    ("Melhorar clareza", AiWritingAction::ImproveClarity),
    ("Resumir", AiWritingAction::Summarize),
    ("Expandir", AiWritingAction::Expand),
    ("Traduzir (português do Brasil)", AiWritingAction::Translate),
    ("Reorganizar ideias", AiWritingAction::ReorganizeIdeas),
];

/// Estado de IA compartilhado pela janela: só o provedor escolhido — a
/// chave em si nunca fica em memória fora do momento da chamada, vem
/// sempre do keyring.
pub type AiSelectedProvider = Rc<Cell<AiProvider>>;

fn provider_label(provider: AiProvider) -> &'static str {
    PROVIDER_LABELS.iter().find(|(_, p)| *p == provider).map(|(label, _)| *label).unwrap_or("OpenAI")
}

fn show_message(window: &adw::ApplicationWindow, heading: &str, body: &str) {
    let alert = adw::AlertDialog::new(Some(heading), Some(body));
    alert.add_response("ok", "OK");
    alert.present(Some(window));
}

/// Abre o diálogo de configuração de IA: escolher provedor e gravar a
/// chave de API no chaveiro do sistema.
pub fn open_settings_dialog(window: &adw::ApplicationWindow, selected_provider: &AiSelectedProvider) {
    let labels: Vec<&str> = PROVIDER_LABELS.iter().map(|(label, _)| *label).collect();
    let model = gtk::StringList::new(&labels);
    let dropdown = gtk::DropDown::new(Some(model), gtk::Expression::NONE);
    let current_index = PROVIDER_LABELS.iter().position(|(_, p)| *p == selected_provider.get()).unwrap_or(0);
    dropdown.set_selected(current_index as u32);

    let key_entry = gtk::PasswordEntry::builder().show_peek_icon(true).placeholder_text("Chave de API (deixe em branco pra manter a atual)").build();

    let status_label = gtk::Label::builder().xalign(0.0).css_classes(["dim-label"]).build();
    let refresh_status = {
        let status_label = status_label.clone();
        move |provider: AiProvider| {
            let configured = ai::ai_api_key_status(provider).configured;
            status_label.set_text(if configured {
                "Chave já configurada para este provedor."
            } else {
                "Nenhuma chave configurada para este provedor ainda."
            });
        }
    };
    refresh_status(selected_provider.get());

    dropdown.connect_selected_notify(glib::clone!(
        #[strong]
        refresh_status,
        move |dropdown| {
            let (_, provider) = PROVIDER_LABELS[dropdown.selected() as usize];
            refresh_status(provider);
        }
    ));

    let content = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(8)
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .build();
    content.append(&gtk::Label::builder().label("Provedor").xalign(0.0).build());
    content.append(&dropdown);
    content.append(&gtk::Label::builder().label("Chave de API").xalign(0.0).build());
    content.append(&key_entry);
    content.append(&status_label);

    let body = format!(
        "Provedor atual: {}. A chave é guardada no chaveiro do sistema (Secret Service), nunca em texto puro.",
        provider_label(selected_provider.get())
    );
    let dialog = adw::AlertDialog::builder().heading("Configurar IA").body(body).extra_child(&content).build();
    dialog.add_response("cancel", "Cancelar");
    dialog.add_response("save", "Salvar");
    dialog.set_response_appearance("save", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("save"));
    dialog.set_close_response("cancel");

    dialog.connect_response(
        None,
        glib::clone!(
            #[strong]
            selected_provider,
            #[weak]
            window,
            #[weak]
            dropdown,
            #[weak]
            key_entry,
            move |_dialog, response| {
                if response != "save" {
                    return;
                }
                let (_, provider) = PROVIDER_LABELS[dropdown.selected() as usize];
                selected_provider.set(provider);
                let key = key_entry.text();
                if key.is_empty() {
                    return;
                }
                if let Err(err) = ai::set_ai_api_key(provider, &key) {
                    show_message(&window, "Não foi possível salvar a chave", &err.to_string());
                }
            }
        ),
    );

    dialog.present(Some(window));
}

/// Roda uma ação de IA sobre a seleção atual do buffer (ou o documento
/// inteiro, se nada estiver selecionado), numa thread separada, mostrando
/// o resultado num diálogo de confirmação antes de aplicar.
pub fn run_action(window: &adw::ApplicationWindow, buffer: &gtk::TextBuffer, provider: AiProvider, action: AiWritingAction) {
    let (start, end) = buffer.selection_bounds().unwrap_or_else(|| buffer.bounds());
    let start_offset = start.offset();
    let end_offset = end.offset();
    let text = buffer.text(&start, &end, false).to_string();

    if text.trim().is_empty() {
        show_message(window, "Nada para processar", "Selecione um texto ou escreva algo no documento antes de usar a IA.");
        return;
    }

    let model = provider.default_model().to_string();

    let (tx, rx) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        let outcome = (|| -> Result<ai::AiTextResult, String> {
            let api_key = ai::get_ai_api_key(provider)
                .map_err(|e| e.to_string())?
                .filter(|k| !k.is_empty())
                .ok_or_else(|| format!("Falta configurar a chave de API do provedor {provider}."))?;
            let request = AiWritingRequest { action, text, instruction: None, target_language: None, tone: None };
            ai::run_writing_action(provider, &model, &api_key, &request, ai::DEFAULT_MAX_OUTPUT_TOKENS).map_err(|e| e.to_string())
        })();
        let _ = tx.send(outcome);
    });

    glib::idle_add_local(glib::clone!(
        #[weak]
        window,
        #[weak]
        buffer,
        #[upgrade_or]
        glib::ControlFlow::Break,
        move || match rx.try_recv() {
            Ok(Ok(result)) => {
                show_result_dialog(&window, &buffer, start_offset, end_offset, &result.text);
                glib::ControlFlow::Break
            }
            Ok(Err(message)) => {
                show_message(&window, "Não foi possível concluir a ação de IA", &message);
                glib::ControlFlow::Break
            }
            Err(std::sync::mpsc::TryRecvError::Empty) => glib::ControlFlow::Continue,
            Err(std::sync::mpsc::TryRecvError::Disconnected) => glib::ControlFlow::Break,
        }
    ));
}

fn show_result_dialog(window: &adw::ApplicationWindow, buffer: &gtk::TextBuffer, start_offset: i32, end_offset: i32, result_text: &str) {
    let dialog = adw::AlertDialog::new(Some("Resultado da IA"), Some(result_text));
    dialog.add_response("cancel", "Descartar");
    dialog.add_response("apply", "Aplicar");
    dialog.set_response_appearance("apply", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("apply"));
    dialog.set_close_response("cancel");

    let result_text = result_text.to_string();
    dialog.connect_response(
        None,
        glib::clone!(
            #[weak]
            buffer,
            move |_dialog, response| {
                if response != "apply" {
                    return;
                }
                let mut start = buffer.iter_at_offset(start_offset);
                let mut end = buffer.iter_at_offset(end_offset);
                buffer.delete(&mut start, &mut end);
                buffer.insert(&mut start, &result_text);
            }
        ),
    );

    dialog.present(Some(window));
}
