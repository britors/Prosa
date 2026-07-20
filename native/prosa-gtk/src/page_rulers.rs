//! Réguas horizontal e vertical alinhadas à página A4 ativa.

use gtk::prelude::*;

use crate::page_geometry::{PageGeometry, SCREEN_DPI};
use crate::paged_editor::PagedEditor;

const RULER_THICKNESS: i32 = 28;

#[derive(Clone)]
pub struct PageRulers {
    grid: gtk::Grid,
}

impl PageRulers {
    pub fn new(editor: &PagedEditor, geometry: PageGeometry) -> Self {
        let style_manager = adw::StyleManager::default();
        let horizontal = gtk::DrawingArea::builder().height_request(RULER_THICKNESS).hexpand(true).build();
        horizontal.add_css_class("prosa-ruler");
        let vertical = gtk::DrawingArea::builder().width_request(RULER_THICKNESS).vexpand(true).build();
        vertical.add_css_class("prosa-ruler");
        let corner = gtk::Box::new(gtk::Orientation::Vertical, 0);
        corner.add_css_class("prosa-ruler-corner");
        corner.set_size_request(RULER_THICKNESS, RULER_THICKNESS);

        let scrolled = editor.widget();
        let hadjustment = scrolled.hadjustment();
        let vadjustment = scrolled.vadjustment();
        horizontal.set_draw_func({
            let hadjustment = hadjustment.clone();
            let style_manager = style_manager.clone();
            move |_area, cr, width, height| {
                draw_horizontal(cr, width, height, geometry, hadjustment.value(), style_manager.is_dark())
            }
        });
        vertical.set_draw_func({
            let vadjustment = vadjustment.clone();
            let editor = editor.clone();
            let style_manager = style_manager.clone();
            move |_area, cr, width, height| {
                draw_vertical(cr, width, height, geometry, editor.active_page(), vadjustment.value(), style_manager.is_dark())
            }
        });
        style_manager.connect_dark_notify(glib::clone!(
            #[weak]
            horizontal,
            #[weak]
            vertical,
            move |_| {
                horizontal.queue_draw();
                vertical.queue_draw();
            }
        ));

        hadjustment.connect_value_changed(glib::clone!(
            #[weak]
            horizontal,
            move |_| horizontal.queue_draw()
        ));
        vadjustment.connect_value_changed(glib::clone!(
            #[weak]
            vertical,
            move |_| vertical.queue_draw()
        ));
        editor.connect_active_page_changed(glib::clone!(
            #[weak]
            vertical,
            move || vertical.queue_draw()
        ));

        let grid = gtk::Grid::new();
        grid.attach(&corner, 0, 0, 1, 1);
        grid.attach(&horizontal, 1, 0, 1, 1);
        grid.attach(&vertical, 0, 1, 1, 1);
        grid.attach(&scrolled, 1, 1, 1, 1);
        grid.set_hexpand(true);
        grid.set_vexpand(true);

        Self { grid }
    }

    pub fn widget(&self) -> gtk::Grid {
        self.grid.clone()
    }
}

fn page_left(viewport_width: i32, page_width: i32, scroll_x: f64) -> f64 {
    ((viewport_width - page_width).max(0) as f64 / 2.0) - scroll_x
}

fn draw_horizontal(cr: &cairo::Context, width: i32, height: i32, geometry: PageGeometry, scroll_x: f64, dark: bool) {
    let palette = RulerPalette::for_theme(dark);
    let page_width = geometry.width_px();
    let left = page_left(width, page_width, scroll_x);
    fill_color(cr, 0.0, 0.0, width as f64, height as f64, palette.outside);
    fill_color(cr, left, 0.0, page_width as f64, height as f64, palette.paper);

    let margin_left = PageGeometry::mm_to_pixels(geometry.margin_left_mm, SCREEN_DPI) as f64;
    let margin_right = PageGeometry::mm_to_pixels(geometry.margin_right_mm, SCREEN_DPI) as f64;
    fill_color(cr, left, 0.0, margin_left, height as f64, palette.margin);
    fill_color(cr, left + page_width as f64 - margin_right, 0.0, margin_right, height as f64, palette.margin);

    draw_horizontal_ticks(cr, left, geometry.width_mm, height, palette.ink);
}

fn draw_vertical(
    cr: &cairo::Context,
    width: i32,
    height: i32,
    geometry: PageGeometry,
    active_page: usize,
    scroll_y: f64,
    dark: bool,
) {
    let palette = RulerPalette::for_theme(dark);
    let page_height = geometry.height_px() as f64;
    let gap = PageGeometry::mm_to_pixels(geometry.page_gap_mm, SCREEN_DPI) as f64;
    let top = gap / 2.0 + active_page as f64 * (page_height + gap) - scroll_y;
    fill_color(cr, 0.0, 0.0, width as f64, height as f64, palette.outside);
    fill_color(cr, 0.0, top, width as f64, page_height, palette.paper);
    let margin_top = PageGeometry::mm_to_pixels(geometry.margin_top_mm, SCREEN_DPI) as f64;
    let margin_bottom = PageGeometry::mm_to_pixels(geometry.margin_bottom_mm, SCREEN_DPI) as f64;
    fill_color(cr, 0.0, top, width as f64, margin_top, palette.margin);
    fill_color(cr, 0.0, top + page_height - margin_bottom, width as f64, margin_bottom, palette.margin);
    draw_vertical_ticks(cr, top, geometry.height_mm, width, palette.ink);
}

#[derive(Clone, Copy)]
struct RulerPalette {
    outside: (f64, f64, f64),
    paper: (f64, f64, f64),
    margin: (f64, f64, f64),
    ink: (f64, f64, f64),
}

impl RulerPalette {
    fn for_theme(dark: bool) -> Self {
        if dark {
            Self { outside: (0.10, 0.10, 0.10), paper: (0.28, 0.28, 0.28), margin: (0.18, 0.18, 0.18), ink: (0.88, 0.88, 0.88) }
        } else {
            Self { outside: (0.82, 0.82, 0.82), paper: (0.97, 0.97, 0.97), margin: (0.76, 0.76, 0.76), ink: (0.20, 0.20, 0.20) }
        }
    }
}

fn fill_color(cr: &cairo::Context, x: f64, y: f64, width: f64, height: f64, color: (f64, f64, f64)) {
    cr.set_source_rgb(color.0, color.1, color.2);
    cr.rectangle(x, y, width, height);
    cr.fill().ok();
}

fn draw_horizontal_ticks(cr: &cairo::Context, origin: f64, length_mm: f64, height: i32, ink: (f64, f64, f64)) {
    cr.set_source_rgb(ink.0, ink.1, ink.2);
    cr.set_line_width(1.0);
    for millimeter in 0..=length_mm.round() as i32 {
        let x = origin + PageGeometry::mm_to_pixels(millimeter as f64, SCREEN_DPI) as f64 + 0.5;
        let tick = if millimeter % 10 == 0 { 10.0 } else if millimeter % 5 == 0 { 7.0 } else { 4.0 };
        cr.move_to(x, height as f64);
        cr.line_to(x, height as f64 - tick);
    }
    cr.stroke().ok();
    draw_horizontal_labels(cr, origin, length_mm, height);
}

fn draw_horizontal_labels(cr: &cairo::Context, origin: f64, length_mm: f64, height: i32) {
    cr.select_font_face("Sans", cairo::FontSlant::Normal, cairo::FontWeight::Normal);
    cr.set_font_size(8.0);
    for centimeter in 0..=length_mm.round() as i32 / 10 {
        let x = origin + PageGeometry::mm_to_pixels((centimeter * 10) as f64, SCREEN_DPI) as f64;
        cr.move_to(x + 2.0, height as f64 - 12.0);
        cr.show_text(&centimeter.to_string()).ok();
    }
}

fn draw_vertical_ticks(cr: &cairo::Context, origin: f64, length_mm: f64, width: i32, ink: (f64, f64, f64)) {
    cr.set_source_rgb(ink.0, ink.1, ink.2);
    cr.set_line_width(1.0);
    for millimeter in 0..=length_mm.round() as i32 {
        let y = origin + PageGeometry::mm_to_pixels(millimeter as f64, SCREEN_DPI) as f64 + 0.5;
        let tick = if millimeter % 10 == 0 { 10.0 } else if millimeter % 5 == 0 { 7.0 } else { 4.0 };
        cr.move_to(width as f64, y);
        cr.line_to(width as f64 - tick, y);
    }
    cr.stroke().ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centered_page_origin_tracks_viewport_and_scroll() {
        assert_eq!(page_left(1000, 794, 0.0), 103.0);
        assert_eq!(page_left(600, 794, 0.0), 0.0);
        assert_eq!(page_left(600, 794, 40.0), -40.0);
    }
}
