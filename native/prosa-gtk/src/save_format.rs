//! Escolha de formato ao salvar um documento pela primeira vez, espelhando a
//! modal "Salvar como" do editor Electron (`src/renderer/components/format-dialog.ts`):
//! mesma ideia (perguntar o formato antes de abrir o seletor de arquivo),
//! mas usando os response buttons nativos do `AdwAlertDialog` — o mesmo
//! padrão já usado em `ai_ui::open_settings_dialog` — em vez da grade de
//! cartões HTML do original.
//!
//! Só os formatos com escrita implementada no lado nativo (`prosa-doc`)
//! aparecem aqui — EPUB/Markdown/texto puro existem no Electron mas ainda
//! não têm um writer nativo correspondente.

use adw::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveFormat {
    Prosa,
    Docx,
    Odt,
    Rtf,
}

impl SaveFormat {
    pub const ALL: [SaveFormat; 4] = [SaveFormat::Prosa, SaveFormat::Docx, SaveFormat::Odt, SaveFormat::Rtf];

    pub fn extension(self) -> &'static str {
        match self {
            SaveFormat::Prosa => "prosa",
            SaveFormat::Docx => "docx",
            SaveFormat::Odt => "odt",
            SaveFormat::Rtf => "rtf",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            SaveFormat::Prosa => "Documento Prosa (.prosa)",
            SaveFormat::Docx => "Word (.docx)",
            SaveFormat::Odt => "OpenDocument (.odt)",
            SaveFormat::Rtf => "Rich Text (.rtf)",
        }
    }

    /// Formato a partir da extensão de um caminho já existente (usado ao
    /// reabrir/resssalvar um documento sem perguntar de novo).
    pub fn from_extension(extension: &str) -> Option<SaveFormat> {
        SaveFormat::ALL.into_iter().find(|format| format.extension().eq_ignore_ascii_case(extension))
    }

    fn response_id(self) -> &'static str {
        match self {
            SaveFormat::Prosa => "format-prosa",
            SaveFormat::Docx => "format-docx",
            SaveFormat::Odt => "format-odt",
            SaveFormat::Rtf => "format-rtf",
        }
    }

    fn from_response_id(id: &str) -> Option<SaveFormat> {
        SaveFormat::ALL.into_iter().find(|format| format.response_id() == id)
    }
}

/// Mostra a modal de escolha de formato; chama `on_choice` com o formato
/// selecionado (não chama nada se o usuário cancelar ou fechar a modal).
pub fn show_format_picker(window: &adw::ApplicationWindow, on_choice: impl Fn(SaveFormat) + 'static) {
    let dialog = adw::AlertDialog::builder().heading("Salvar como").body("Escolha o formato do arquivo:").build();
    for format in SaveFormat::ALL {
        dialog.add_response(format.response_id(), format.label());
    }
    dialog.set_response_appearance(SaveFormat::Prosa.response_id(), adw::ResponseAppearance::Suggested);
    dialog.add_response("cancel", "Cancelar");
    dialog.set_close_response("cancel");

    dialog.connect_response(None, move |_dialog, response| {
        if let Some(format) = SaveFormat::from_response_id(response) {
            on_choice(format);
        }
    });

    dialog.present(Some(window));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_id_round_trips_for_every_format() {
        for format in SaveFormat::ALL {
            assert_eq!(SaveFormat::from_response_id(format.response_id()), Some(format));
        }
    }

    #[test]
    fn from_response_id_rejects_cancel() {
        assert_eq!(SaveFormat::from_response_id("cancel"), None);
    }

    #[test]
    fn from_extension_is_case_insensitive() {
        assert_eq!(SaveFormat::from_extension("DOCX"), Some(SaveFormat::Docx));
        assert_eq!(SaveFormat::from_extension("prosa"), Some(SaveFormat::Prosa));
        assert_eq!(SaveFormat::from_extension("pdf"), None);
    }
}
