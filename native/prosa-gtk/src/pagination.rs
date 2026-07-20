//! Regra única de medição e quebra usada pela tela e pelo PDF.

use crate::page_geometry::PageGeometry;
use pango::prelude::FontMapExt;

pub fn document_layout(markup: &str, geometry: PageGeometry) -> pango::Layout {
    let font_map = pangocairo::FontMap::new();
    let context = font_map.create_context();
    pangocairo::functions::context_set_resolution(&context, 72.0);
    let layout = pango::Layout::new(&context);
    layout.set_markup(markup);
    layout.set_width((geometry.usable_width_points() * pango::SCALE as f64).round() as i32);
    layout
}

/// Inícios das páginas em coordenadas Pango do layout lógico.
pub fn page_breaks(layout: &pango::Layout, geometry: PageGeometry) -> Vec<i32> {
    let content_height = (geometry.usable_height_points() * pango::SCALE as f64).round() as i32;
    let mut breaks = vec![0];
    let mut current_top = 0;
    let mut iter = layout.iter();
    let mut first = true;
    loop {
        let (y0, y1) = iter.line_yrange();
        if !first && y1 - current_top > content_height {
            breaks.push(y0);
            current_top = y0;
        }
        first = false;
        if !iter.next_line() {
            break;
        }
    }
    breaks
}
