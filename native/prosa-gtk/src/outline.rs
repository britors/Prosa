//! Painel de tópicos (esboço automático), espelhando
//! `src/renderer/components/sidebar-outline.ts`: detecta os títulos H1-H3
//! do buffer e numera hierarquicamente ("1", "1.1", "2", ...), igual ao
//! original — subir de nível zera a subnumeração dos níveis abaixo (depois
//! de "2.1", um novo H1 vira "3", não "3.1").
//!
//! Diferente da versão Electron (que reconsulta o DOM renderizado a cada
//! clique), aqui cada item guarda diretamente a linha do buffer onde o
//! título está, já que não existe um DOM à parte pra consultar.

use gtk::prelude::*;

use crate::formatting::{heading_level_at_line, line_range};

pub struct OutlineEntry {
    pub line: i32,
    pub level: u8,
    pub number: String,
    pub text: String,
}

fn line_text(buffer: &gtk::TextBuffer, line: i32) -> String {
    let (start, end) = line_range(buffer, line);
    buffer.text(&start, &end, false).trim().to_string()
}

/// Escaneia o buffer inteiro e monta a lista de tópicos.
pub fn build_outline(buffer: &gtk::TextBuffer) -> Vec<OutlineEntry> {
    let mut counters = [0u32; 3];
    let mut entries = Vec::new();

    for line in 0..buffer.line_count() {
        let Some(level) = heading_level_at_line(buffer, line) else { continue };
        let index = (level - 1) as usize;
        counters[index] += 1;
        for counter in counters.iter_mut().skip(index + 1) {
            *counter = 0;
        }
        let number = counters[..=index].iter().filter(|&&c| c > 0).map(|c| c.to_string()).collect::<Vec<_>>().join(".");
        entries.push(OutlineEntry { line, level, number, text: line_text(buffer, line) });
    }

    entries
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::formatting::{set_heading_level, setup_heading_tags};

    pub(crate) fn numbers_headings_hierarchically_and_resets_on_level_up() {
        let buffer = gtk::TextBuffer::new(None);
        setup_heading_tags(&buffer);
        buffer.set_text("Introdução\nContexto\nMetodologia\nColeta\nAnálise\nConclusão");
        // H1 Introdução / H2 Contexto / H1 Metodologia / H2 Coleta / H2 Análise / H1 Conclusão
        set_heading_level(&buffer, 0, Some(1));
        set_heading_level(&buffer, 1, Some(2));
        set_heading_level(&buffer, 2, Some(1));
        set_heading_level(&buffer, 3, Some(2));
        set_heading_level(&buffer, 4, Some(2));
        set_heading_level(&buffer, 5, Some(1));

        let entries = build_outline(&buffer);
        let numbers: Vec<&str> = entries.iter().map(|e| e.number.as_str()).collect();
        assert_eq!(numbers, vec!["1", "1.1", "2", "2.1", "2.2", "3"]);

        let texts: Vec<&str> = entries.iter().map(|e| e.text.as_str()).collect();
        assert_eq!(texts, vec!["Introdução", "Contexto", "Metodologia", "Coleta", "Análise", "Conclusão"]);
    }

    pub(crate) fn ignores_lines_without_heading() {
        let buffer = gtk::TextBuffer::new(None);
        setup_heading_tags(&buffer);
        buffer.set_text("texto normal\nTítulo\nmais texto normal");
        set_heading_level(&buffer, 1, Some(1));

        let entries = build_outline(&buffer);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].line, 1);
        assert_eq!(entries[0].level, 1);
    }

    pub(crate) fn empty_document_has_no_outline() {
        let buffer = gtk::TextBuffer::new(None);
        setup_heading_tags(&buffer);
        assert!(build_outline(&buffer).is_empty());
    }
}
