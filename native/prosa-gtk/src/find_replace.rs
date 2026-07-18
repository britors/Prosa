//! Localizar & substituir.
//!
//! Espelha `src/renderer/editor/extensions/find-replace.ts`: mesmas três
//! opções (diferenciar maiúsculas, palavra inteira, regex), mesmo critério
//! de destaque (uma tag para "todos os matches", outra pra "o match
//! atual"), recálculo completo a cada busca/edição (não incremental, igual
//! ao original). A regra mais importante a replicar corretamente é
//! `replace_all`: precisa aplicar em ordem **reversa** de posição — trocar
//! um match mais cedo no texto invalidaria os offsets dos matches
//! seguintes que ainda não foram processados.

use gtk::prelude::*;
use gtk::{gdk, TextBuffer, TextIter, TextTag};
use regex::{Regex, RegexBuilder};

const MATCH_TAG_NAME: &str = "prosa-search-match";
const CURRENT_TAG_NAME: &str = "prosa-search-current";

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
}

/// Monta a regex de busca: termo escapado literalmente a menos que `regex`
/// esteja ligado; envolve em `\b...\b` se `whole_word`. Uma regex inválida
/// (só possível com `regex: true`) resulta em `None` — zero matches, sem
/// erro pro usuário, igual ao original.
fn build_regex(term: &str, options: SearchOptions) -> Option<Regex> {
    if term.is_empty() {
        return None;
    }
    let escaped;
    let pattern = if options.regex {
        term
    } else {
        escaped = regex::escape(term);
        &escaped
    };
    let pattern = if options.whole_word { format!(r"\b{pattern}\b") } else { pattern.to_string() };
    RegexBuilder::new(&pattern).case_insensitive(!options.case_sensitive).build().ok()
}

fn char_offset(text: &str, byte_offset: usize) -> i32 {
    text[..byte_offset].chars().count() as i32
}

/// Estado vivo de uma busca: as ocorrências encontradas (offsets de
/// caractere) e qual delas é a "atual".
#[derive(Default)]
pub struct FindReplace {
    matches: Vec<(i32, i32)>,
    current: usize,
}

fn ensure_tags(buffer: &TextBuffer) -> (TextTag, TextTag) {
    let table = buffer.tag_table();
    let match_tag = table.lookup(MATCH_TAG_NAME).unwrap_or_else(|| {
        let tag = TextTag::builder().name(MATCH_TAG_NAME).background_rgba(&gdk::RGBA::new(0.024, 0.714, 0.831, 0.35)).build();
        table.add(&tag);
        tag
    });
    let current_tag = table.lookup(CURRENT_TAG_NAME).unwrap_or_else(|| {
        let tag = TextTag::builder().name(CURRENT_TAG_NAME).background_rgba(&gdk::RGBA::new(0.98, 0.75, 0.14, 1.0)).build();
        table.add(&tag);
        tag
    });
    (match_tag, current_tag)
}

impl FindReplace {
    pub fn match_count(&self) -> usize {
        self.matches.len()
    }

    /// Posição (1-indexada, pra exibição) do match atual, se houver algum.
    pub fn current_position(&self) -> Option<usize> {
        if self.matches.is_empty() {
            None
        } else {
            Some(self.current + 1)
        }
    }

    /// Recalcula todas as ocorrências do zero e reaplica os destaques —
    /// chamar a cada mudança no termo/opções, ou depois de qualquer edição
    /// do documento (não é incremental, igual ao original).
    pub fn search(&mut self, buffer: &TextBuffer, term: &str, options: SearchOptions) {
        let (match_tag, current_tag) = ensure_tags(buffer);
        let (start, end) = buffer.bounds();
        buffer.remove_tag(&match_tag, &start, &end);
        buffer.remove_tag(&current_tag, &start, &end);

        self.matches.clear();
        self.current = 0;

        let Some(regex) = build_regex(term, options) else { return };
        let text = buffer.text(&start, &end, false).to_string();
        for m in regex.find_iter(&text) {
            if m.start() == m.end() {
                continue; // ignora matches de tamanho zero (regex degenerada)
            }
            self.matches.push((char_offset(&text, m.start()), char_offset(&text, m.end())));
        }

        for &(s, e) in &self.matches {
            let start_iter = buffer.iter_at_offset(s);
            let end_iter = buffer.iter_at_offset(e);
            buffer.apply_tag(&match_tag, &start_iter, &end_iter);
        }
        self.highlight_current(buffer);
    }

    fn highlight_current(&self, buffer: &TextBuffer) {
        let (_, current_tag) = ensure_tags(buffer);
        let (start, end) = buffer.bounds();
        buffer.remove_tag(&current_tag, &start, &end);
        if let Some(&(s, e)) = self.matches.get(self.current) {
            let start_iter = buffer.iter_at_offset(s);
            let end_iter = buffer.iter_at_offset(e);
            buffer.apply_tag(&current_tag, &start_iter, &end_iter);
        }
    }

    /// Avança pro próximo match (circular) e devolve o início dele, pra
    /// quem chamou centralizar a rolagem.
    pub fn go_next(&mut self, buffer: &TextBuffer) -> Option<TextIter> {
        if self.matches.is_empty() {
            return None;
        }
        self.current = (self.current + 1) % self.matches.len();
        self.highlight_current(buffer);
        self.matches.get(self.current).map(|&(s, _)| buffer.iter_at_offset(s))
    }

    /// Volta pro match anterior (circular).
    pub fn go_previous(&mut self, buffer: &TextBuffer) -> Option<TextIter> {
        if self.matches.is_empty() {
            return None;
        }
        self.current = if self.current == 0 { self.matches.len() - 1 } else { self.current - 1 };
        self.highlight_current(buffer);
        self.matches.get(self.current).map(|&(s, _)| buffer.iter_at_offset(s))
    }

    /// Substitui só o match atual. Quem chamar deve rodar `search` de novo
    /// em seguida (os offsets dos outros matches podem ter mudado).
    pub fn replace_current(&self, buffer: &TextBuffer, replacement: &str) {
        if let Some(&(s, e)) = self.matches.get(self.current) {
            let mut start_iter = buffer.iter_at_offset(s);
            let mut end_iter = buffer.iter_at_offset(e);
            buffer.delete(&mut start_iter, &mut end_iter);
            buffer.insert(&mut start_iter, replacement);
        }
    }

    /// Substitui todas as ocorrências. Crítico: em ordem reversa de
    /// posição — trocar um match mais cedo no texto mudaria o tamanho do
    /// documento e invalidaria os offsets (já capturados) dos matches
    /// seguintes.
    pub fn replace_all(&self, buffer: &TextBuffer, replacement: &str) {
        for &(s, e) in self.matches.iter().rev() {
            let mut start_iter = buffer.iter_at_offset(s);
            let mut end_iter = buffer.iter_at_offset(e);
            buffer.delete(&mut start_iter, &mut end_iter);
            buffer.insert(&mut start_iter, replacement);
        }
    }

    /// Limpa a busca: remove os destaques e zera o estado.
    pub fn clear(&mut self, buffer: &TextBuffer) {
        let (match_tag, current_tag) = ensure_tags(buffer);
        let (start, end) = buffer.bounds();
        buffer.remove_tag(&match_tag, &start, &end);
        buffer.remove_tag(&current_tag, &start, &end);
        self.matches.clear();
        self.current = 0;
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn build_regex_escapes_literal_terms_by_default() {
        let options = SearchOptions::default();
        let regex = build_regex("a.b", options).unwrap();
        assert!(regex.is_match("a.b"));
        assert!(!regex.is_match("axb"), "termo literal não devia tratar '.' como coringa");
    }

    #[test]
    fn build_regex_whole_word_uses_word_boundaries() {
        let options = SearchOptions { whole_word: true, ..Default::default() };
        let regex = build_regex("cat", options).unwrap();
        assert!(regex.is_match("the cat sat"));
        assert!(!regex.is_match("category"));
    }

    #[test]
    fn build_regex_case_insensitive_by_default() {
        let options = SearchOptions::default();
        let regex = build_regex("Cat", options).unwrap();
        assert!(regex.is_match("cat"));
        assert!(regex.is_match("CAT"));
    }

    #[test]
    fn build_regex_case_sensitive_when_requested() {
        let options = SearchOptions { case_sensitive: true, ..Default::default() };
        let regex = build_regex("Cat", options).unwrap();
        assert!(regex.is_match("Cat"));
        assert!(!regex.is_match("cat"));
    }

    #[test]
    fn build_regex_invalid_pattern_in_regex_mode_returns_none() {
        let options = SearchOptions { regex: true, ..Default::default() };
        assert!(build_regex("(unclosed", options).is_none());
    }

    #[test]
    fn build_regex_empty_term_returns_none() {
        assert!(build_regex("", SearchOptions::default()).is_none());
    }

    pub(crate) fn search_finds_all_occurrences_with_accented_text() {
        let buffer = TextBuffer::new(None);
        buffer.set_text("café com leite, café sem açúcar");
        let mut fr = FindReplace::default();
        fr.search(&buffer, "café", SearchOptions::default());
        assert_eq!(fr.match_count(), 2);
        assert_eq!(fr.current_position(), Some(1));
    }

    pub(crate) fn navigation_wraps_around_circularly() {
        let buffer = TextBuffer::new(None);
        buffer.set_text("um dois um tres um");
        let mut fr = FindReplace::default();
        fr.search(&buffer, "um", SearchOptions::default());
        assert_eq!(fr.match_count(), 3);
        assert_eq!(fr.current_position(), Some(1));

        fr.go_next(&buffer);
        assert_eq!(fr.current_position(), Some(2));
        fr.go_next(&buffer);
        assert_eq!(fr.current_position(), Some(3));
        fr.go_next(&buffer);
        assert_eq!(fr.current_position(), Some(1), "deve dar a volta pro primeiro match");

        fr.go_previous(&buffer);
        assert_eq!(fr.current_position(), Some(3), "deve dar a volta pro último match");
    }

    pub(crate) fn replace_current_only_changes_the_current_match() {
        let buffer = TextBuffer::new(None);
        buffer.set_text("gato gato gato");
        let mut fr = FindReplace::default();
        fr.search(&buffer, "gato", SearchOptions::default());
        fr.go_next(&buffer); // vai pro segundo "gato"
        fr.replace_current(&buffer, "cachorro");

        let (start, end) = buffer.bounds();
        assert_eq!(buffer.text(&start, &end, false), "gato cachorro gato");
    }

    pub(crate) fn replace_all_handles_different_length_replacement_without_corruption() {
        let buffer = TextBuffer::new(None);
        buffer.set_text("x y x y x");
        let mut fr = FindReplace::default();
        fr.search(&buffer, "x", SearchOptions::default());
        assert_eq!(fr.match_count(), 3);
        // Substituição mais longa que o original — se a ordem de aplicação
        // estivesse errada (do início pro fim), os offsets dos matches
        // seguintes ficariam defasados e corromperiam o texto.
        fr.replace_all(&buffer, "XYZ");

        let (start, end) = buffer.bounds();
        assert_eq!(buffer.text(&start, &end, false), "XYZ y XYZ y XYZ");
    }

    pub(crate) fn clear_removes_highlights_and_resets_state() {
        let buffer = TextBuffer::new(None);
        buffer.set_text("teste teste");
        let mut fr = FindReplace::default();
        fr.search(&buffer, "teste", SearchOptions::default());
        assert_eq!(fr.match_count(), 2);
        fr.clear(&buffer);
        assert_eq!(fr.match_count(), 0);
        assert_eq!(fr.current_position(), None);
    }
}
