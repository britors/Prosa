//! Paginação A4 e exportação para PDF.
//!
//! Cobre a issue "Fase 2: Paginação A4 e impressão/PDF": a edição em tela
//! continua em fluxo contínuo (`GtkTextView` sem noção de páginas — ver
//! `main.rs`), e a paginação real só é calculada aqui, na hora de exportar,
//! via `GtkPrintOperation` + Pango/Cairo.
//!
//! Estratégia: o documento inteiro vira um único `pango::Layout` (para que a
//! quebra de linha seja consistente do início ao fim), e cada página é
//! desenhada recortando (`clip`) e deslocando (`translate`) esse mesmo layout,
//! em vez de fatiar o texto em layouts separados por página.

use std::cell::RefCell;
use std::path::Path;
use std::rc::Rc;

use gtk::prelude::*;
use gtk::{glib, PrintContext, PrintOperation};
use prosa_doc::TipTapNode;

use crate::page_geometry::PageGeometry;
use crate::pagination;

/// Remove tags HTML de forma simplista (o cabeçalho/rodapé do `.prosa` é
/// HTML vindo da versão Electron; aqui extraímos só o texto, sem formatação).
fn strip_html(input: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for c in input.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Desenha uma única linha de texto (cabeçalho/rodapé/número de página).
fn draw_band(cr: &cairo::Context, context: &PrintContext, text: &str, x: f64, y: f64, width: f64, alignment: pango::Alignment) {
    let layout = context.create_pango_layout();
    layout.set_text(text);
    layout.set_width((width * pango::SCALE as f64) as i32);
    layout.set_alignment(alignment);
    cr.save().ok();
    cr.translate(x, y);
    pangocairo::functions::show_layout(cr, &layout);
    cr.restore().ok();
}

struct PrintState {
    layout: pagination::DocumentLayout,
    breaks: Vec<i32>,
}

/// Exporta o documento para um arquivo PDF (sem diálogo de impressão),
/// paginando em A4 e repetindo cabeçalho/rodapé + número de página.
pub fn export_to_pdf(
    window: &impl IsA<gtk::Window>,
    path: &Path,
    doc: &TipTapNode,
    header: Option<&str>,
    footer: Option<&str>,
    geometry: PageGeometry,
) -> Result<(), glib::Error> {
    run_print_operation(window, Some(path), doc, header, footer, geometry, gtk::PrintOperationAction::Export)
}

/// Abre o diálogo nativo do sistema e imprime usando o mesmo layout do PDF.
pub fn print_document(
    window: &impl IsA<gtk::Window>,
    doc: &TipTapNode,
    header: Option<&str>,
    footer: Option<&str>,
    geometry: PageGeometry,
) -> Result<(), glib::Error> {
    run_print_operation(window, None, doc, header, footer, geometry, gtk::PrintOperationAction::PrintDialog)
}

fn run_print_operation(
    window: &impl IsA<gtk::Window>,
    export_path: Option<&Path>,
    doc: &TipTapNode,
    header: Option<&str>,
    footer: Option<&str>,
    geometry: PageGeometry,
    action: gtk::PrintOperationAction,
) -> Result<(), glib::Error> {
    let page = Rc::new(geometry);
    let doc = Rc::new(doc.clone());
    let header_text = header.map(strip_html).filter(|s| !s.is_empty());
    let footer_text = footer.map(strip_html).filter(|s| !s.is_empty());

    let op = PrintOperation::new();
    if let Some(path) = export_path { op.set_export_filename(path); }
    op.set_default_page_setup(Some(&{
        let setup = gtk::PageSetup::new();
        setup.set_paper_size(&gtk::PaperSize::new_custom(
            "prosa-page", "Prosa", page.width_mm, page.height_mm, gtk::Unit::Mm,
        ));
        setup.set_top_margin(0.0, gtk::Unit::Mm);
        setup.set_bottom_margin(0.0, gtk::Unit::Mm);
        setup.set_left_margin(0.0, gtk::Unit::Mm);
        setup.set_right_margin(0.0, gtk::Unit::Mm);
        setup
    }));

    let state: Rc<RefCell<Option<PrintState>>> = Rc::new(RefCell::new(None));

    op.connect_begin_print(glib::clone!(
        #[strong]
        state,
        #[strong]
        page,
        #[strong]
        doc,
        move |op, _context| {
            let layout = pagination::layout_document(&doc, *page);
            let breaks = pagination::document_page_breaks(&layout, *page);
            op.set_n_pages(breaks.len() as i32);
            *state.borrow_mut() = Some(PrintState { layout, breaks });
        }
    ));

    op.connect_draw_page(glib::clone!(
        #[strong]
        state,
        #[strong]
        page,
        #[strong]
        header_text,
        #[strong]
        footer_text,
        move |_op, context, page_nr| {
            let borrowed = state.borrow();
            let Some(print_state) = borrowed.as_ref() else { return };
            let cr = context.cairo_context();

            let content_top = page.body_top_points();
            let content_height = page.usable_height_points();
            let margin_left = PageGeometry::mm_to_points(page.margin_left_mm);
            let top_pango = print_state.breaks[page_nr as usize];

            cr.save().ok();
            cr.rectangle(margin_left, content_top, page.usable_width_points(), content_height);
            cr.clip();
            cr.translate(margin_left, content_top - (top_pango as f64 / pango::SCALE as f64));
            for paragraph in &print_state.layout.paragraphs {
                cr.save().ok();
                cr.translate(paragraph.x_points, paragraph.y_pango as f64 / pango::SCALE as f64);
                pangocairo::functions::show_layout(&cr, &paragraph.layout);
                cr.restore().ok();
            }
            cr.restore().ok();

            if let Some(text) = &header_text {
                draw_band(
                    &cr,
                    context,
                    text,
                    margin_left,
                    PageGeometry::mm_to_points(page.margin_top_mm),
                    page.usable_width_points(),
                    pango::Alignment::Center,
                );
            }

            let page_number_text = format!("Página {} de {}", page_nr + 1, print_state.breaks.len());
            let footer_line = match &footer_text {
                Some(footer) => format!("{footer}    —    {page_number_text}"),
                None => page_number_text,
            };
            draw_band(
                &cr,
                context,
                &footer_line,
                margin_left,
                page.height_points()
                    - PageGeometry::mm_to_points(page.margin_bottom_mm + page.footer_height_mm),
                page.usable_width_points(),
                pango::Alignment::Center,
            );
        }
    ));

    op.run(action, Some(window))?;
    Ok(())
}

/// Ver nota em `formatting::tests` sobre por que estes testes não têm
/// `#[test]` próprio (todos os testes que dependem de GTK precisam rodar na
/// mesma thread, então são chamados a partir de um único `#[test]` central
/// em `tests.rs`).
#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use prosa_doc::Mark;

    fn text_node(text: &str) -> TipTapNode {
        TipTapNode { kind: "text".to_string(), text: Some(text.to_string()), ..Default::default() }
    }

    fn bold_node(text: &str) -> TipTapNode {
        TipTapNode {
            kind: "text".to_string(),
            text: Some(text.to_string()),
            marks: Some(vec![Mark { kind: "bold".to_string(), attrs: None }]),
            ..Default::default()
        }
    }

    fn paragraph(children: Vec<TipTapNode>) -> TipTapNode {
        TipTapNode { kind: "paragraph".to_string(), content: Some(children), ..Default::default() }
    }

    /// Documento longo o bastante para estourar uma página A4 com as margens
    /// do preset "academic", forçando múltiplas páginas na exportação.
    fn long_doc() -> TipTapNode {
        let paragraphs: Vec<TipTapNode> = (0..80)
            .map(|i| {
                paragraph(vec![
                    text_node(&format!("Parágrafo número {i}: ")),
                    bold_node("um trecho em negrito"),
                    text_node(", seguido de bastante texto para garantir que a linha quebre mais de uma vez dentro da largura da página A4 com as margens do preset acadêmico."),
                ])
            })
            .collect();
        TipTapNode { kind: "doc".to_string(), content: Some(paragraphs), ..Default::default() }
    }

    /// Conta páginas via `pdfinfo` (poppler-utils). O PDF gerado pelo cairo
    /// usa cross-reference streams e object streams comprimidos (Flate), então
    /// não dá para simplesmente procurar `/Type /Page` no arquivo bruto — os
    /// objetos de página estão comprimidos. Se `pdfinfo` não estiver
    /// disponível no ambiente de teste, retorna `None` (checagem pulada) em
    /// vez de falhar o teste por falta de uma ferramenta externa opcional.
    fn count_pdf_pages_via_pdfinfo(path: &std::path::Path) -> Option<usize> {
        let output = std::process::Command::new("pdfinfo").arg(path).output().ok()?;
        if !output.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout
            .lines()
            .find_map(|line| line.strip_prefix("Pages:"))
            .and_then(|n| n.trim().parse::<usize>().ok())
    }

    pub(crate) fn export_produces_multi_page_pdf_with_pagination() {
        let window = gtk::Window::new();
        let doc = long_doc();
        let mut geometry = PageGeometry::academic_a4();
        geometry.margin_left_mm = 31.0;
        geometry.margin_right_mm = 17.0;
        geometry.margin_top_mm = 28.0;
        let expected_pages = pagination::document_page_breaks(&pagination::layout_document(&doc, geometry), geometry).len();

        let dir = std::env::temp_dir().join(format!("prosa-print-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("saida.pdf");

        export_to_pdf(&window, &path, &doc, Some("<p>Cabeçalho de teste</p>"), Some("<p>Rodapé de teste</p>"), geometry)
            .expect("exportação deve ter sucesso");

        let bytes = std::fs::read(&path).expect("o arquivo PDF deve existir");
        assert!(bytes.starts_with(b"%PDF"), "deve começar com o cabeçalho de um PDF válido");
        assert!(bytes.len() > 500, "o PDF gerado não deveria ficar vazio/trivial");

        match count_pdf_pages_via_pdfinfo(&path) {
            Some(pages) => {
                assert!(pages > 1, "um documento longo deve gerar mais de uma página (contou {pages})");
                assert_eq!(pages, expected_pages, "tela e PDF devem usar a mesma decisão de quebra");
            }
            None => eprintln!("aviso: pdfinfo indisponível, checagem de número de páginas pulada"),
        }

        std::fs::remove_file(&path).ok();
        std::fs::remove_dir(&dir).ok();
    }

    pub(crate) fn page_breaks_split_when_content_overflows() {
        let long_text = (0..40).map(|i| format!("linha número {i}")).collect::<Vec<_>>().join("\n");
        let doc = TipTapNode::doc_from_plain_text(&long_text);

        // Altura de conteúdo pequena o bastante para caber só algumas linhas por página.
        let mut geometry = PageGeometry::academic_a4();
        geometry.height_mm = geometry.margin_top_mm
            + geometry.header_height_mm
            + geometry.footer_height_mm
            + geometry.margin_bottom_mm
            + 60.0 / 72.0 * 25.4;
        let layout = pagination::layout_document(&doc, geometry);
        let breaks = pagination::document_page_breaks(&layout, geometry);
        assert!(breaks.len() > 1, "40 linhas não devem caber todas numa página de 60pt de altura");
        assert_eq!(breaks[0], 0, "a primeira página sempre começa em y=0");
    }

    pub(crate) fn shared_layout_applies_geometry_indents_and_tabs() {
        let doc = TipTapNode {
            kind: "doc".to_string(),
            content: Some(vec![TipTapNode {
                kind: "paragraph".to_string(),
                attrs: Some(serde_json::json!({
                    "marginLeft": 24, "marginRight": 16, "firstLineIndent": 12,
                    "tabStops": [{ "position": 48, "alignment": "right" }]
                })),
                content: Some(vec![text_node("coluna\tvalor")]),
                ..Default::default()
            }]),
            ..Default::default()
        };
        let mut geometry = PageGeometry::academic_a4();
        geometry.margin_left_mm = 30.0;
        geometry.margin_right_mm = 15.0;
        let laid_out = pagination::layout_document(&doc, geometry);
        let paragraph = &laid_out.paragraphs[0];
        assert!((paragraph.x_points - 18.0).abs() < 0.001);
        assert_eq!(paragraph.layout.indent(), 9 * pango::SCALE);
        assert_eq!(paragraph.layout.tabs().unwrap().tab(0), (pango::TabAlign::Right, 36 * pango::SCALE));
        let expected_width = ((geometry.usable_width_points() - 30.0) * pango::SCALE as f64).round() as i32;
        assert_eq!(paragraph.layout.width(), expected_width);
    }

    pub(crate) fn repeated_margin_changes_keep_shared_pagination_stable() {
        let doc = long_doc();
        for step in 0..20 {
            let mut geometry = PageGeometry::academic_a4();
            geometry.margin_left_mm = 10.0 + step as f64;
            geometry.margin_right_mm = 29.0 - step as f64;
            let first = pagination::document_page_breaks(&pagination::layout_document(&doc, geometry), geometry);
            let second = pagination::document_page_breaks(&pagination::layout_document(&doc, geometry), geometry);
            assert_eq!(first, second);
            assert!(!first.is_empty());
        }
    }
}
