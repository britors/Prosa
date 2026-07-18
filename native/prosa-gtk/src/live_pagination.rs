//! Paginação A4 ao vivo na tela.
//!
//! A "folha" (`GtkTextView`) fica com largura fixa e fundo branco,
//! centralizada sobre um fundo escuro (a "mesa" ao redor) — ver
//! `install_page_css` em `main.rs`.
//!
//! Este módulo só faz a *medição*: onde (em coordenadas de buffer) cada
//! página A4 termina, andando linha visual por linha visual via
//! `TextView::forward_display_line` + `iter_location` (soma corretamente
//! parágrafos que ocupam várias linhas na tela — uma versão anterior usava
//! só `line_yrange`, que mede a linha *visual*, e por isso nunca via quebra
//! num parágrafo longo). A parte visual (as linhas de quebra desenhadas por
//! cima do texto) é responsabilidade de `main.rs`, via um `GtkOverlay`.
//!
//! ## Duas abordagens de indicador visual descartadas antes desta
//!
//! 1ª tentativa: inserir um widget de verdade no meio do texto via
//! `GtkTextChildAnchor`. Entrou num loop de remedição do GTK (a altura
//! exigida da `TextView` crescia sem parar, nunca convergindo) e travou o
//! processo.
//!
//! 2ª tentativa: `GtkTextTag` com `pixels-below-lines` na última linha de
//! cada página (não insere/remove conteúdo do buffer, então não tem o
//! problema da 1ª). Mas essa propriedade só se aplica a *parágrafos*
//! inteiros — não dá pra quebrar no meio de um parágrafo longo (comum em
//! prosa real), então documentos com poucos parágrafos grandes nunca
//! ganhavam quebra nenhuma.
//!
//! Um `GtkOverlay` com widgets flutuantes (a abordagem atual) resolve os
//! dois problemas: não toca o buffer e funciona em qualquer ponto, não só
//! em fronteira de parágrafo. Uma suspeita inicial de que o `GtkOverlay`
//! também travava (mesmo loop de remedição da 1ª tentativa) não se
//! confirmou: era contaminação de teste — invocar o binário repetidamente
//! reativa a mesma instância do GApplication em vez de abrir um processo
//! novo, então os testes estavam medindo o app real sendo redimensionado
//! na tela, não um bug determinístico. Confirmado estável em 10+ execuções
//! isoladas (`application_id` só do teste) com um documento de estresse
//! (parágrafo único de ~250 frases).

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use gtk::prelude::*;
use gtk::{glib, TextBuffer, TextView};

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

const PAGE_CONTENT_HEIGHT_PX: i32 = PAGE_HEIGHT_PX - MARGIN_TOP_PX - MARGIN_BOTTOM_PX;

/// Estado vivo da paginação: os pontos de quebra (em coordenadas de buffer,
/// eixo Y) encontrados no último recálculo.
#[derive(Default)]
pub struct LivePagination {
    page_count: Cell<usize>,
    break_points_buffer_y: RefCell<Vec<i32>>,
    debounce_source: RefCell<Option<glib::SourceId>>,
}

impl LivePagination {
    pub fn page_count(&self) -> usize {
        self.page_count.get().max(1)
    }

    /// Coordenadas Y (de buffer) de cada quebra, do último recálculo.
    pub fn break_points_buffer_y(&self) -> Vec<i32> {
        self.break_points_buffer_y.borrow().clone()
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
        let mut iter = buffer.start_iter();
        let mut page_start_y = text_view.iter_location(&iter).y();
        let mut breaks = Vec::new();

        loop {
            let rect = text_view.iter_location(&iter);
            let line_bottom = rect.y() + rect.height();
            if line_bottom - page_start_y > PAGE_CONTENT_HEIGHT_PX {
                breaks.push(rect.y());
                page_start_y = rect.y();
            }
            if !text_view.forward_display_line(&mut iter) {
                break;
            }
        }

        self.page_count.set(breaks.len() + 1);
        *self.break_points_buffer_y.borrow_mut() = breaks;
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
