//! Réguas horizontal e vertical alinhadas à página A4 ativa.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use gtk::prelude::*;

use crate::page_geometry::{PageGeometry, SCREEN_DPI};
use crate::paged_editor::PagedEditor;
use crate::formatting::{self, ParagraphIndent, TabKind, TabStop};

const RULER_THICKNESS: i32 = 28;

#[derive(Clone)]
pub struct PageRulers {
    grid: gtk::Grid,
}

impl PageRulers {
    pub fn new(editor: &PagedEditor) -> Self {
        let style_manager = adw::StyleManager::default();
        let horizontal = gtk::DrawingArea::builder().height_request(RULER_THICKNESS).hexpand(true).build();
        horizontal.add_css_class("prosa-ruler");
        let vertical = gtk::DrawingArea::builder().width_request(RULER_THICKNESS).vexpand(true).build();
        vertical.add_css_class("prosa-ruler");
        let selected_tab = Rc::new(Cell::new(TabKind::Left));
        let corner = gtk::Button::with_label("L");
        corner.add_css_class("prosa-ruler-corner");
        corner.set_size_request(RULER_THICKNESS, RULER_THICKNESS);
        corner.set_tooltip_text(Some("Tipo de tabulação: esquerda (clique para alternar)"));
        corner.connect_clicked({
            let selected_tab = selected_tab.clone();
            move |button| {
                let next = match selected_tab.get() { TabKind::Left => TabKind::Center, TabKind::Center => TabKind::Right, TabKind::Right => TabKind::Decimal, TabKind::Decimal => TabKind::Left };
                selected_tab.set(next);
                let (label, tooltip) = match next { TabKind::Left => ("L", "esquerda"), TabKind::Center => ("⊥", "central"), TabKind::Right => ("⅃", "direita"), TabKind::Decimal => ("·", "decimal") };
                button.set_label(label);
                button.set_tooltip_text(Some(&format!("Tipo de tabulação: {tooltip} (clique para alternar)")));
            }
        });

        let scrolled = editor.widget();
        let hadjustment = scrolled.hadjustment();
        let vadjustment = scrolled.vadjustment();
        horizontal.set_draw_func({
            let hadjustment = hadjustment.clone();
            let style_manager = style_manager.clone();
            let editor = editor.clone();
            move |_area, cr, width, height| {
                let buffer = editor.buffer();
                let indent = formatting::paragraph_indent_at_line(&buffer, formatting::current_line(&buffer));
                let tabs = formatting::paragraph_tabs_at_line(&buffer, formatting::current_line(&buffer));
                draw_horizontal(cr, width, height, editor.geometry(), indent, &tabs, hadjustment.value(), style_manager.is_dark())
            }
        });
        vertical.set_draw_func({
            let vadjustment = vadjustment.clone();
            let editor = editor.clone();
            let style_manager = style_manager.clone();
            move |_area, cr, width, height| {
                draw_vertical(cr, width, height, editor.geometry(), editor.active_page(), vadjustment.value(), style_manager.is_dark())
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
        editor.connect_geometry_changed(glib::clone!(
            #[weak]
            horizontal,
            #[weak]
            vertical,
            move |_| {
                horizontal.queue_draw();
                vertical.queue_draw();
            }
        ));
        editor.buffer().connect_cursor_position_notify(glib::clone!(
            #[weak]
            horizontal,
            move |_| horizontal.queue_draw()
        ));

        install_horizontal_drag(&horizontal, editor, &hadjustment);
        install_tab_click(&horizontal, editor, &hadjustment, selected_tab);
        install_vertical_drag(&vertical, editor, &vadjustment);

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

#[derive(Clone, Copy)]
enum MarginHandle {
    Left,
    Right,
    Top,
    Bottom,
    IndentLeft,
    IndentFirstLine,
    IndentRight,
    Tab(usize),
}

#[derive(Clone)]
struct MarginDrag {
    handle: MarginHandle,
    original: PageGeometry,
    indent: ParagraphIndent,
    lines: Vec<i32>,
    tabs: Vec<TabStop>,
    start_y: f64,
}

fn install_horizontal_drag(area: &gtk::DrawingArea, editor: &PagedEditor, adjustment: &gtk::Adjustment) {
    area.set_tooltip_text(Some("Arraste os limites cinza para ajustar as margens esquerda e direita"));
    let state: Rc<RefCell<Option<MarginDrag>>> = Rc::new(RefCell::new(None));
    let drag = gtk::GestureDrag::new();
    drag.connect_drag_begin({
        let editor = editor.clone();
        let adjustment = adjustment.clone();
        let state = state.clone();
        move |gesture, x, y| {
            let geometry = editor.geometry();
            let width = gesture.widget().map(|widget| widget.width()).unwrap_or_default();
            let left = page_left(width, geometry.width_px(), adjustment.value());
            let left_handle = left + PageGeometry::mm_to_pixels(geometry.margin_left_mm, SCREEN_DPI) as f64;
            let right_handle = left + geometry.width_px() as f64
                - PageGeometry::mm_to_pixels(geometry.margin_right_mm, SCREEN_DPI) as f64;
            let buffer = editor.buffer();
            let line = formatting::current_line(&buffer);
            let indent = formatting::paragraph_indent_at_line(&buffer, line);
            let tabs = formatting::paragraph_tabs_at_line(&buffer, line);
            let indent_left = left_handle + indent.left_px as f64;
            let indent_first = indent_left + indent.first_line_px as f64;
            let indent_right = right_handle - indent.right_px as f64;
            let tab_handles = tabs.iter().enumerate().map(|(index, stop)| (left_handle + stop.position_px as f64, MarginHandle::Tab(index))).collect::<Vec<_>>();
            let handle = if (9.0..19.0).contains(&y) {
                tab_handles.into_iter().filter(|(coordinate, _)| (x - coordinate).abs() <= 8.0).min_by(|a, b| (x - a.0).abs().total_cmp(&(x - b.0).abs())).map(|(_, handle)| handle)
                    .or_else(|| nearest_handle(x, [(indent_left, MarginHandle::IndentLeft), (indent_right, MarginHandle::IndentRight)]))
            } else if y < 9.0 {
                nearest_handle(x, [(indent_first, MarginHandle::IndentFirstLine), (indent_right, MarginHandle::IndentRight)])
            } else {
                nearest_handle(x, [(left_handle, MarginHandle::Left), (right_handle, MarginHandle::Right)])
            };
            *state.borrow_mut() = handle.map(|handle| MarginDrag { handle, original: geometry, indent, lines: formatting::selected_lines(&buffer), tabs, start_y: y });
        }
    });
    drag.connect_drag_update({
        let editor = editor.clone();
        let state = state.clone();
        move |gesture, offset_x, _| {
            if let Some(drag) = state.borrow().clone() {
                update_horizontal_drag(&editor, drag, offset_x, 0.0, false);
                if let Some(widget) = gesture.widget() { widget.queue_draw(); }
            }
        }
    });
    drag.connect_drag_end({
        let editor = editor.clone();
        let state = state.clone();
        move |gesture, offset_x, offset_y| {
            if let Some(drag) = state.borrow_mut().take() {
                update_horizontal_drag(&editor, drag, offset_x, offset_y, true);
                if let Some(widget) = gesture.widget() { widget.queue_draw(); }
            }
        }
    });
    area.add_controller(drag);
}

fn install_vertical_drag(area: &gtk::DrawingArea, editor: &PagedEditor, adjustment: &gtk::Adjustment) {
    area.set_tooltip_text(Some("Arraste os limites cinza para ajustar as margens superior e inferior"));
    let state: Rc<RefCell<Option<MarginDrag>>> = Rc::new(RefCell::new(None));
    let drag = gtk::GestureDrag::new();
    drag.connect_drag_begin({
        let editor = editor.clone();
        let adjustment = adjustment.clone();
        let state = state.clone();
        move |_, _, y| {
            let geometry = editor.geometry();
            let top = page_top(geometry, editor.active_page(), adjustment.value());
            let top_handle = top + PageGeometry::mm_to_pixels(geometry.margin_top_mm, SCREEN_DPI) as f64;
            let bottom_handle = top + geometry.height_px() as f64
                - PageGeometry::mm_to_pixels(geometry.margin_bottom_mm, SCREEN_DPI) as f64;
            let handle = nearest_handle(y, [(top_handle, MarginHandle::Top), (bottom_handle, MarginHandle::Bottom)]);
            *state.borrow_mut() = handle.map(|handle| MarginDrag { handle, original: geometry, indent: ParagraphIndent::default(), lines: Vec::new(), tabs: Vec::new(), start_y: y });
        }
    });
    drag.connect_drag_update({
        let editor = editor.clone();
        let state = state.clone();
        move |_, _, offset_y| {
            if let Some(drag) = state.borrow().clone() {
                editor.preview_geometry(adjust_geometry(drag, pixels_to_mm(offset_y)));
            }
        }
    });
    drag.connect_drag_end({
        let editor = editor.clone();
        let state = state.clone();
        move |_, _, offset_y| {
            if let Some(drag) = state.borrow_mut().take() {
                editor.commit_geometry(adjust_geometry(drag, pixels_to_mm(offset_y)));
            }
        }
    });
    area.add_controller(drag);
}

fn nearest_handle<const N: usize>(position: f64, handles: [(f64, MarginHandle); N]) -> Option<MarginHandle> {
    handles.into_iter().filter(|(coordinate, _)| (position - coordinate).abs() <= 10.0).min_by(|a, b| {
        (position - a.0).abs().total_cmp(&(position - b.0).abs())
    }).map(|(_, handle)| handle)
}

fn pixels_to_mm(pixels: f64) -> f64 {
    pixels / SCREEN_DPI * 25.4
}

fn install_tab_click(area: &gtk::DrawingArea, editor: &PagedEditor, adjustment: &gtk::Adjustment, selected: Rc<Cell<TabKind>>) {
    let click = gtk::GestureClick::new();
    click.connect_released({
        let area = area.clone();
        let editor = editor.clone();
        let adjustment = adjustment.clone();
        move |_, presses, x, y| {
            if presses != 1 || !(9.0..19.0).contains(&y) { return; }
            let geometry = editor.geometry();
            let width = area.width();
            let content_left = page_left(width, geometry.width_px(), adjustment.value()) + PageGeometry::mm_to_pixels(geometry.margin_left_mm, SCREEN_DPI) as f64;
            let max = PageGeometry::mm_to_pixels(geometry.usable_width_mm(), SCREEN_DPI);
            let position = (x - content_left).round() as i32;
            if !(1..max).contains(&position) { return; }
            let buffer = editor.buffer();
            let line = formatting::current_line(&buffer);
            let mut tabs = formatting::paragraph_tabs_at_line(&buffer, line);
            if tabs.iter().any(|stop| (stop.position_px - position).abs() <= 8) { return; }
            tabs.push(TabStop { position_px: position, kind: selected.get() });
            for line in formatting::selected_lines(&buffer) { formatting::set_paragraph_tabs(&buffer, line, tabs.clone()); }
            area.queue_draw();
            editor.repaginate_now();
        }
    });
    area.add_controller(click);
}

fn update_horizontal_drag(editor: &PagedEditor, drag: MarginDrag, offset_x: f64, offset_y: f64, commit: bool) {
    match drag.handle {
        MarginHandle::IndentLeft | MarginHandle::IndentFirstLine | MarginHandle::IndentRight => {
            let geometry = editor.geometry();
            let max_width = PageGeometry::mm_to_pixels(geometry.usable_width_mm(), SCREEN_DPI).max(1);
            let mut indent = drag.indent;
            match drag.handle {
                MarginHandle::IndentLeft => indent.left_px = (indent.left_px as f64 + offset_x).round() as i32,
                MarginHandle::IndentFirstLine => indent.first_line_px = (indent.first_line_px as f64 + offset_x).round() as i32,
                MarginHandle::IndentRight => indent.right_px = (indent.right_px as f64 - offset_x).round() as i32,
                _ => {}
            }
            indent.left_px = indent.left_px.clamp(0, max_width - indent.right_px - 20);
            indent.right_px = indent.right_px.clamp(0, max_width - indent.left_px - 20);
            indent.first_line_px = indent.first_line_px.clamp(-indent.left_px, max_width - indent.left_px - indent.right_px - 20);
            let buffer = editor.buffer();
            for line in &drag.lines { formatting::set_paragraph_indent(&buffer, *line, indent); }
            if commit { editor.repaginate_now(); }
        }
        MarginHandle::Tab(index) => {
            let max = PageGeometry::mm_to_pixels(editor.geometry().usable_width_mm(), SCREEN_DPI);
            let mut tabs = drag.tabs;
            if commit && !(0.0..RULER_THICKNESS as f64).contains(&(drag.start_y + offset_y)) {
                tabs.remove(index);
            } else if let Some(stop) = tabs.get_mut(index) {
                stop.position_px = (stop.position_px as f64 + offset_x).round().clamp(1.0, (max - 1) as f64) as i32;
            }
            let buffer = editor.buffer();
            for line in &drag.lines { formatting::set_paragraph_tabs(&buffer, *line, tabs.clone()); }
            if commit { editor.repaginate_now(); }
        }
        _ => {
            let geometry = adjust_geometry(drag, pixels_to_mm(offset_x));
            if commit { editor.commit_geometry(geometry); } else { editor.preview_geometry(geometry); }
        }
    }
}

fn adjust_geometry(drag: MarginDrag, delta_mm: f64) -> PageGeometry {
    let mut geometry = drag.original;
    const MIN_MARGIN_MM: f64 = 5.0;
    const MIN_BODY_WIDTH_MM: f64 = 50.0;
    const MIN_BODY_HEIGHT_MM: f64 = 80.0;
    match drag.handle {
        MarginHandle::Left => {
            geometry.margin_left_mm = (geometry.margin_left_mm + delta_mm).clamp(
                MIN_MARGIN_MM,
                geometry.width_mm - geometry.margin_right_mm - MIN_BODY_WIDTH_MM,
            );
        }
        MarginHandle::Right => {
            geometry.margin_right_mm = (geometry.margin_right_mm - delta_mm).clamp(
                MIN_MARGIN_MM,
                geometry.width_mm - geometry.margin_left_mm - MIN_BODY_WIDTH_MM,
            );
        }
        MarginHandle::Top => {
            geometry.margin_top_mm = (geometry.margin_top_mm + delta_mm).clamp(
                MIN_MARGIN_MM,
                geometry.height_mm
                    - geometry.margin_bottom_mm
                    - geometry.header_height_mm
                    - geometry.footer_height_mm
                    - MIN_BODY_HEIGHT_MM,
            );
        }
        MarginHandle::Bottom => {
            geometry.margin_bottom_mm = (geometry.margin_bottom_mm - delta_mm).clamp(
                MIN_MARGIN_MM,
                geometry.height_mm
                    - geometry.margin_top_mm
                    - geometry.header_height_mm
                    - geometry.footer_height_mm
                    - MIN_BODY_HEIGHT_MM,
            );
        }
        MarginHandle::IndentLeft | MarginHandle::IndentFirstLine | MarginHandle::IndentRight | MarginHandle::Tab(_) => {}
    }
    geometry
}

fn page_left(viewport_width: i32, page_width: i32, scroll_x: f64) -> f64 {
    ((viewport_width - page_width).max(0) as f64 / 2.0) - scroll_x
}

fn page_top(geometry: PageGeometry, active_page: usize, scroll_y: f64) -> f64 {
    let page_height = geometry.height_px() as f64;
    let gap = PageGeometry::mm_to_pixels(geometry.page_gap_mm, SCREEN_DPI) as f64;
    gap / 2.0 + active_page as f64 * (page_height + gap) - scroll_y
}

fn draw_horizontal(cr: &cairo::Context, width: i32, height: i32, geometry: PageGeometry, indent: ParagraphIndent, tabs: &[TabStop], scroll_x: f64, dark: bool) {
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
    draw_indent_markers(cr, left, geometry, indent, palette.ink);
    draw_tab_stops(cr, left + margin_left, tabs, palette.ink);
}

fn draw_tab_stops(cr: &cairo::Context, origin: f64, tabs: &[TabStop], ink: (f64, f64, f64)) {
    cr.set_source_rgb(ink.0, ink.1, ink.2);
    cr.set_line_width(1.5);
    for stop in tabs {
        let x = origin + stop.position_px as f64;
        cr.move_to(x, 10.0); cr.line_to(x, 18.0);
        match stop.kind {
            TabKind::Left => cr.line_to(x + 5.0, 18.0),
            TabKind::Right => cr.line_to(x - 5.0, 18.0),
            TabKind::Center => { cr.move_to(x - 4.0, 18.0); cr.line_to(x + 4.0, 18.0); }
            TabKind::Decimal => { cr.move_to(x - 4.0, 18.0); cr.line_to(x + 2.0, 18.0); cr.rectangle(x + 3.0, 16.5, 1.5, 1.5); }
        }
        cr.stroke().ok();
    }
}

fn draw_indent_markers(cr: &cairo::Context, page_left: f64, geometry: PageGeometry, indent: ParagraphIndent, ink: (f64, f64, f64)) {
    let margin_left = PageGeometry::mm_to_pixels(geometry.margin_left_mm, SCREEN_DPI) as f64;
    let margin_right = PageGeometry::mm_to_pixels(geometry.margin_right_mm, SCREEN_DPI) as f64;
    cr.set_source_rgb(ink.0, ink.1, ink.2);
    for x in [page_left + margin_left + indent.left_px as f64 + indent.first_line_px as f64, page_left + geometry.width_px() as f64 - margin_right - indent.right_px as f64] {
        cr.move_to(x, 1.0); cr.line_to(x - 5.0, 8.0); cr.line_to(x + 5.0, 8.0); cr.close_path(); cr.fill().ok();
    }
    let x = page_left + margin_left + indent.left_px as f64;
    cr.move_to(x, 17.0); cr.line_to(x - 5.0, 10.0); cr.line_to(x + 5.0, 10.0); cr.close_path(); cr.fill().ok();
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
    let top = page_top(geometry, active_page, scroll_y);
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

    fn margin_drag(handle: MarginHandle, original: PageGeometry) -> MarginDrag {
        MarginDrag { handle, original, indent: ParagraphIndent::default(), lines: Vec::new(), tabs: Vec::new(), start_y: 0.0 }
    }

    #[test]
    fn centered_page_origin_tracks_viewport_and_scroll() {
        assert_eq!(page_left(1000, 794, 0.0), 103.0);
        assert_eq!(page_left(600, 794, 0.0), 0.0);
        assert_eq!(page_left(600, 794, 40.0), -40.0);
    }

    #[test]
    fn dragged_margin_preserves_minimum_body_size() {
        let original = PageGeometry::academic_a4();
        let left = adjust_geometry(margin_drag(MarginHandle::Left, original), 500.0);
        assert!((left.usable_width_mm() - 50.0).abs() < 1e-9);
        assert_eq!(left.margin_right_mm, original.margin_right_mm);

        let top = adjust_geometry(margin_drag(MarginHandle::Top, original), 500.0);
        assert!((top.usable_height_mm() - 80.0).abs() < 1e-9);
        assert_eq!(top.margin_bottom_mm, original.margin_bottom_mm);
    }

    #[test]
    fn dragged_margin_never_becomes_smaller_than_five_millimeters() {
        let original = PageGeometry::academic_a4();
        let right = adjust_geometry(margin_drag(MarginHandle::Right, original), 500.0);
        let bottom = adjust_geometry(margin_drag(MarginHandle::Bottom, original), 500.0);
        assert_eq!(right.margin_right_mm, 5.0);
        assert_eq!(bottom.margin_bottom_mm, 5.0);
    }
}
