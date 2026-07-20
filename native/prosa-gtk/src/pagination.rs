//! Regra única de medição e quebra usada pela tela e pelo PDF.

use crate::page_geometry::PageGeometry;
use crate::formatting::markup_from_block;
use pango::prelude::FontMapExt;
use prosa_doc::TipTapNode;

pub struct ParagraphLayout {
    pub layout: pango::Layout,
    pub x_points: f64,
    pub y_pango: i32,
}

pub struct DocumentLayout {
    pub paragraphs: Vec<ParagraphLayout>,
    line_ranges: Vec<(i32, i32)>,
}

fn int_attr(block: &TipTapNode, name: &str) -> i32 {
    block.attrs.as_ref().and_then(|attrs| attrs.get(name)).and_then(|value| value.as_i64())
        .and_then(|value| i32::try_from(value).ok()).unwrap_or_default()
}

fn screen_px_to_points(value: i32) -> f64 { value as f64 * 72.0 / 96.0 }

pub fn layout_document(doc: &TipTapNode, geometry: PageGeometry) -> DocumentLayout {
    let font_map = pangocairo::FontMap::new();
    let context = font_map.create_context();
    pangocairo::functions::context_set_resolution(&context, 72.0);
    let mut paragraphs = Vec::new();
    let mut line_ranges = Vec::new();
    let mut y = 0;
    for block in doc.content.as_deref().unwrap_or_default() {
        let left = int_attr(block, "marginLeft").clamp(0, 10_000);
        let right = int_attr(block, "marginRight").clamp(0, 10_000);
        let first = int_attr(block, "firstLineIndent").clamp(-10_000, 10_000);
        let layout = pango::Layout::new(&context);
        layout.set_markup(&markup_from_block(block));
        let width = (geometry.usable_width_points() - screen_px_to_points(left + right)).max(1.0);
        layout.set_width((width * pango::SCALE as f64).round() as i32);
        layout.set_indent((screen_px_to_points(first) * pango::SCALE as f64).round() as i32);
        if let Some(align) = block.attrs.as_ref().and_then(|attrs| attrs.get("textAlign")).and_then(|value| value.as_str()) {
            layout.set_alignment(match align { "center" => pango::Alignment::Center, "right" => pango::Alignment::Right, _ => pango::Alignment::Left });
            layout.set_justify(align == "justify");
        }
        if let Some(stops) = block.attrs.as_ref().and_then(|attrs| attrs.get("tabStops")).and_then(|value| value.as_array()) {
            let valid = stops.iter().filter_map(|stop| {
                let position = stop.get("position")?.as_i64().and_then(|value| i32::try_from(value).ok())?;
                let alignment = match stop.get("alignment")?.as_str()? {
                    "left" => pango::TabAlign::Left, "center" => pango::TabAlign::Center,
                    "right" => pango::TabAlign::Right, "decimal" => pango::TabAlign::Decimal, _ => return None,
                };
                (position > 0).then_some((position, alignment))
            }).collect::<Vec<_>>();
            if !valid.is_empty() {
                let mut tabs = pango::TabArray::new(valid.len() as i32, false);
                for (index, (position, alignment)) in valid.iter().enumerate() {
                    tabs.set_tab(index as i32, *alignment, (screen_px_to_points(*position) * pango::SCALE as f64).round() as i32);
                    if *alignment == pango::TabAlign::Decimal { tabs.set_decimal_point(index as i32, ','); }
                }
                layout.set_tabs(Some(&tabs));
            }
        }
        let paragraph_y = y;
        let mut iter = layout.iter();
        loop {
            let (line_y0, line_y1) = iter.line_yrange();
            line_ranges.push((paragraph_y + line_y0, paragraph_y + line_y1));
            if !iter.next_line() { break; }
        }
        y += layout.size().1;
        paragraphs.push(ParagraphLayout { layout, x_points: screen_px_to_points(left), y_pango: paragraph_y });
    }
    DocumentLayout { paragraphs, line_ranges }
}

pub fn document_page_breaks(layout: &DocumentLayout, geometry: PageGeometry) -> Vec<i32> {
    let content_height = (geometry.usable_height_points() * pango::SCALE as f64).round() as i32;
    let mut breaks = vec![0];
    let mut current_top = 0;
    for &(y0, y1) in layout.line_ranges.iter().skip(1) {
        if y1 - current_top > content_height { breaks.push(y0); current_top = y0; }
    }
    breaks
}
