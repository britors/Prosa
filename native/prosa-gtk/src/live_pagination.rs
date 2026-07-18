//! Simulação de páginas A4 na tela.
//!
//! A "folha" (`GtkTextView`) fica com largura fixa e fundo branco,
//! centralizada sobre um fundo escuro (a "mesa" ao redor) — ver
//! `install_page_css` em `main.rs`. Ao ultrapassar a altura de conteúdo de
//! uma página A4, um espaço extra é aplicado à última linha da página via
//! `GtkTextTag` (`pixels-below-lines`), simulando a quebra para a próxima
//! folha.
//!
//! Uma primeira versão tentava inserir um widget de verdade no meio do
//! fluxo do texto via `GtkTextChildAnchor`. Isso entrou num loop de
//! remedição do GTK (o widget some sob medição, o texto fica maior,
//! remede, aumenta de novo — sem nunca convergir) e travou o processo. Uma
//! `GtkTextTag` com `pixels-below-lines` não insere nem remove conteúdo do
//! buffer (só marca um trecho existente), então não dispara `changed` nem
//! participa desse tipo de realimentação — só custa não ter uma cor escura
//! distinta no vão, apenas espaço em branco extra.
//!
//! Diferente da paginação de exportação (`print.rs`, que opera sobre um
//! `pango::Layout` isolado só na hora de gerar o PDF), esta roda ao vivo
//! sobre o próprio `GtkTextView` em edição, medindo a altura real de cada
//! linha via `TextView::line_yrange`. É reconstruída do zero a cada
//! recálculo (remove toda a marcação, remede, reaplica), então não faz
//! tentativa de atualização incremental — aceitável para os tamanhos de
//! documento do MVP.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use gtk::prelude::*;
use gtk::{glib, TextBuffer, TextTag, TextView};

/// A4 a 96dpi (referência padrão do desktop GTK sem escala de HiDPI).
pub const PAGE_WIDTH_PX: i32 = 794;
pub const PAGE_HEIGHT_PX: i32 = 1123;
/// Mesmas margens do preset "academic" usado na exportação (ver
/// `print::PageLayout::academic_a4`), convertidas de polegadas para pixels a
/// 96dpi — mantém a proporção da folha em tela consistente com o PDF.
pub const MARGIN_TOP_PX: i32 = 94;
pub const MARGIN_BOTTOM_PX: i32 = 94;
pub const MARGIN_LEFT_PX: i32 = 76;
pub const MARGIN_RIGHT_PX: i32 = 76;

const PAGE_BREAK_GAP_PX: i32 = 96;
const PAGE_CONTENT_HEIGHT_PX: i32 = PAGE_HEIGHT_PX - MARGIN_TOP_PX - MARGIN_BOTTOM_PX;
const PAGE_BREAK_TAG_NAME: &str = "prosa-page-break";

/// Estado vivo da paginação: quantas páginas o último recálculo encontrou.
pub struct LivePagination {
    page_count: Cell<usize>,
    debounce_source: RefCell<Option<glib::SourceId>>,
}

impl Default for LivePagination {
    fn default() -> Self {
        LivePagination { page_count: Cell::new(1), debounce_source: RefCell::new(None) }
    }
}

impl LivePagination {
    pub fn page_count(&self) -> usize {
        self.page_count.get()
    }

    fn ensure_tag(buffer: &TextBuffer) -> TextTag {
        if let Some(tag) = buffer.tag_table().lookup(PAGE_BREAK_TAG_NAME) {
            return tag;
        }
        let tag = TextTag::builder().name(PAGE_BREAK_TAG_NAME).pixels_below_lines(PAGE_BREAK_GAP_PX).build();
        buffer.tag_table().add(&tag);
        tag
    }

    /// Agenda um recálculo com debounce (250ms) — chamar a cada `changed` do
    /// buffer.
    pub fn schedule_recompute(self: &Rc<Self>, text_view: &TextView, buffer: &TextBuffer, on_done: impl Fn() + 'static) {
        if let Some(source) = self.debounce_source.borrow_mut().take() {
            source.remove();
        }
        let this = Rc::clone(self);
        let text_view = text_view.clone();
        let buffer = buffer.clone();
        let source = glib::timeout_add_local(Duration::from_millis(250), move || {
            *this.debounce_source.borrow_mut() = None;
            this.recompute(&text_view, &buffer);
            on_done();
            glib::ControlFlow::Break
        });
        *self.debounce_source.borrow_mut() = Some(source);
    }

    fn recompute(&self, text_view: &TextView, buffer: &TextBuffer) {
        let tag = Self::ensure_tag(buffer);

        // Remove a marcação inteira antes de remedir do zero — sem isso, o
        // espaço já aplicado por um recálculo anterior distorceria a
        // medição das linhas no próximo.
        let (start, end) = buffer.bounds();
        buffer.remove_tag(&tag, &start, &end);

        let line_count = buffer.line_count();
        let mut cumulative = 0i32;
        let mut break_after_lines = Vec::new();
        for line in 0..line_count {
            let Some(iter) = buffer.iter_at_line(line) else { continue };
            let (_, height) = text_view.line_yrange(&iter);
            if height <= 0 {
                continue;
            }
            if cumulative > 0 && cumulative + height > PAGE_CONTENT_HEIGHT_PX {
                break_after_lines.push(line - 1);
                cumulative = height;
            } else {
                cumulative += height;
            }
        }

        for line in &break_after_lines {
            let Some(line_start) = buffer.iter_at_line(*line) else { continue };
            let line_end = if *line + 1 < line_count { buffer.iter_at_line(*line + 1) } else { None };
            let line_end = line_end.unwrap_or_else(|| buffer.end_iter());
            buffer.apply_tag(&tag, &line_start, &line_end);
        }

        self.page_count.set(break_after_lines.len() + 1);
    }
}

/// Conta palavras (separadas por espaço em branco) e frases (fim de frase
/// `.`/`!`/`?`, tratando pontuação repetida — "..." — como um só fim).
pub fn count_words_and_sentences(text: &str) -> (usize, usize) {
    let words = text.split_whitespace().count();
    let mut sentences = 0usize;
    let mut in_sentence_end = false;
    for c in text.chars() {
        match c {
            '.' | '!' | '?' => {
                if !in_sentence_end {
                    sentences += 1;
                }
                in_sentence_end = true;
            }
            c if c.is_whitespace() => {}
            _ => in_sentence_end = false,
        }
    }
    (words, sentences)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_words_and_sentences() {
        let (words, sentences) = count_words_and_sentences("Olá mundo. Tudo bem? Sim!");
        assert_eq!(words, 5);
        assert_eq!(sentences, 3);
    }

    #[test]
    fn treats_repeated_punctuation_as_one_sentence_end() {
        let (_, sentences) = count_words_and_sentences("Pensando... talvez.");
        assert_eq!(sentences, 2);
    }

    #[test]
    fn empty_text_has_no_words_or_sentences() {
        assert_eq!(count_words_and_sentences(""), (0, 0));
    }
}
