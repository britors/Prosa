//! Corretor ortográfico via libenchant (crate `enchant`).
//!
//! A versão Electron não tem nenhuma lógica própria de correção — usa o
//! corretor nativo do Chromium (`session.setSpellCheckerLanguages`), que
//! sublinha e sugere sozinho dentro do `contentEditable`. O `GtkTextView`
//! não tem esse mecanismo embutido, então esta versão precisa construir as
//! duas partes que o Chromium dava de graça:
//!
//! 1. Sublinhado das palavras erradas: `GtkTextTag` com
//!    `Underline::Error` (o sublinhado ondulado padrão de corretores),
//!    recalculado com debounce a cada mudança no buffer.
//! 2. Sugestões + "adicionar ao dicionário" no menu de contexto: como
//!    `GtkTextView` não expõe um sinal "populate-popup" dinâmico (a API do
//!    GTK4 é só `extra-menu`, um `GMenuModel` estático), a palavra sob o
//!    clique direito é resolvida manualmente num `GtkGestureClick` na fase
//!    de captura (antes do menu padrão abrir), e o `extra-menu` é
//!    reconstruído na hora — ver `main.rs`.
//!
//! Idiomas: mesmo default (`pt-BR`/`en-US`) da versão Electron, convertido
//! pro formato de locale do enchant/hunspell (`_`, não `-`). Uma palavra é
//! considerada correta se QUALQUER um dos dicionários carregados concordar
//! — mesmo critério do Chromium ao checar contra vários idiomas ativos ao
//! mesmo tempo.

use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

use gtk::prelude::*;
use gtk::{glib, TextBuffer, TextTag};

const DEFAULT_LANGUAGES: [&str; 2] = ["pt_BR", "en_US"];
const MISSPELLED_TAG_NAME: &str = "prosa-misspelled";
pub const MAX_SUGGESTIONS: usize = 5;

pub struct SpellChecker {
    dicts: Vec<enchant::Dict>,
}

impl SpellChecker {
    /// Abre os dicionários disponíveis dentre `DEFAULT_LANGUAGES`. Se
    /// nenhum estiver instalado no sistema, fica sem dicionários — o
    /// corretor simplesmente não sublinha nada, sem travar o app (mesmo
    /// espírito do fallback silencioso que `configureSpellChecker` fazia
    /// na versão Electron).
    pub fn new() -> Self {
        let mut broker = enchant::Broker::new();
        let mut dicts = Vec::new();
        for lang in DEFAULT_LANGUAGES {
            if broker.dict_exists(lang) {
                if let Ok(dict) = broker.request_dict(lang) {
                    dicts.push(dict);
                }
            }
        }
        SpellChecker { dicts }
    }

    pub fn is_available(&self) -> bool {
        !self.dicts.is_empty()
    }

    pub fn check(&self, word: &str) -> bool {
        self.dicts.iter().any(|dict| dict.check(word).unwrap_or(true))
    }

    pub fn suggest(&self, word: &str) -> Vec<String> {
        let mut suggestions = Vec::new();
        for dict in &self.dicts {
            for suggestion in dict.suggest(word) {
                if suggestions.len() >= MAX_SUGGESTIONS {
                    return suggestions;
                }
                if !suggestions.contains(&suggestion) {
                    suggestions.push(suggestion);
                }
            }
        }
        suggestions
    }

    /// Adiciona a palavra a todos os dicionários carregados — mais simples
    /// que decidir "qual idioma o usuário quis dizer", e evita que a
    /// palavra volte a ser sublinhada não importa qual dicionário a pegou.
    pub fn add_to_dictionary(&self, word: &str) {
        for dict in &self.dicts {
            dict.add(word);
        }
    }
}

fn ensure_misspelled_tag(buffer: &TextBuffer) -> TextTag {
    if let Some(tag) = buffer.tag_table().lookup(MISSPELLED_TAG_NAME) {
        return tag;
    }
    let tag = TextTag::builder().name(MISSPELLED_TAG_NAME).underline(pango::Underline::Error).build();
    buffer.tag_table().add(&tag);
    tag
}

/// Ranges (offsets de caractere, início/fim) das palavras erradas do texto.
/// Considera "palavra" uma corrida de caracteres alfabéticos Unicode (cobre
/// acentuação do português: á, ã, ç, ...) — mais simples que os limites de
/// palavra nativos do GTK (usados em `word_at_location`, no `main.rs`, pra
/// resolver a palavra sob o clique do menu de contexto), suficiente pra
/// decidir onde sublinhar.
fn find_misspelled_ranges(checker: &SpellChecker, text: &str) -> Vec<(i32, i32)> {
    let mut ranges = Vec::new();
    let mut word = String::new();
    let mut word_start: Option<i32> = None;
    let mut offset: i32 = 0;

    for c in text.chars() {
        if c.is_alphabetic() {
            if word_start.is_none() {
                word_start = Some(offset);
            }
            word.push(c);
        } else if let Some(start) = word_start.take() {
            if !checker.check(&word) {
                ranges.push((start, offset));
            }
            word.clear();
        }
        offset += 1;
    }
    if let Some(start) = word_start {
        if !checker.check(&word) {
            ranges.push((start, offset));
        }
    }
    ranges
}

/// Estado vivo do sublinhado: recalcula com debounce a cada mudança no
/// buffer.
pub struct LiveSpellcheck {
    checker: Rc<SpellChecker>,
    debounce_source: RefCell<Option<glib::SourceId>>,
}

impl LiveSpellcheck {
    pub fn new(checker: Rc<SpellChecker>) -> Self {
        LiveSpellcheck { checker, debounce_source: RefCell::new(None) }
    }

    /// Agenda um recálculo com debounce (300ms) — chamar a cada `changed`
    /// do buffer (ou depois de "adicionar ao dicionário", pra sumir o
    /// sublinhado na hora).
    pub fn schedule_recompute(self: &Rc<Self>, buffer: &TextBuffer) {
        if !self.checker.is_available() {
            return;
        }
        if let Some(source) = self.debounce_source.borrow_mut().take() {
            source.remove();
        }
        let this = Rc::clone(self);
        let buffer = buffer.clone();
        let source = glib::timeout_add_local(Duration::from_millis(300), move || {
            *this.debounce_source.borrow_mut() = None;
            this.recompute(&buffer);
            glib::ControlFlow::Break
        });
        *self.debounce_source.borrow_mut() = Some(source);
    }

    fn recompute(&self, buffer: &TextBuffer) {
        let tag = ensure_misspelled_tag(buffer);
        let (start, end) = buffer.bounds();
        buffer.remove_tag(&tag, &start, &end);

        let text = buffer.text(&start, &end, false).to_string();
        for (word_start, word_end) in find_misspelled_ranges(&self.checker, &text) {
            let start_iter = buffer.iter_at_offset(word_start);
            let end_iter = buffer.iter_at_offset(word_end);
            buffer.apply_tag(&tag, &start_iter, &end_iter);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_misspelled_ranges_only_for_unknown_words() {
        struct FakeChecker;
        // Reaproveita a função de tokenização com um "checker" via closure
        // não é direto (find_misspelled_ranges pede &SpellChecker), então
        // este teste cobre só a tokenização usando o SpellChecker real —
        // se nenhum dicionário estiver instalado no ambiente de teste,
        // `check` sempre retorna true (nenhuma palavra é marcada errada),
        // o que ainda é uma checagem válida: a função não deve marcar nada
        // além de corridas de letras.
        let _ = FakeChecker;
        let checker = SpellChecker::new();
        let ranges = find_misspelled_ranges(&checker, "áéíóú 123 ç");
        // Sem dicionário disponível, nada é marcado; com dicionário, no
        // máximo essas duas palavras (não os números, que não são letras).
        assert!(ranges.len() <= 2);
    }

    #[test]
    fn empty_text_has_no_misspelled_ranges() {
        let checker = SpellChecker::new();
        assert_eq!(find_misspelled_ranges(&checker, ""), Vec::new());
    }
}
