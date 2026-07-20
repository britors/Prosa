//! Editor paginado com um único buffer lógico e múltiplas superfícies A4.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use gtk::prelude::*;

use crate::page_geometry::{PageGeometry, SCREEN_DPI};

#[derive(Clone)]
pub struct PageSurface {
    root: gtk::Box,
    text_view: gtk::TextView,
    body_scrolled: gtk::ScrolledWindow,
    index: Rc<Cell<usize>>,
    body_height_px: i32,
}

impl PageSurface {
    fn new(geometry: PageGeometry, buffer: &gtk::TextBuffer, index: usize) -> Self {
        let body_width = PageGeometry::mm_to_pixels(geometry.usable_width_mm(), SCREEN_DPI);
        let body_height = PageGeometry::mm_to_pixels(geometry.usable_height_mm(), SCREEN_DPI);
        let text_view = gtk::TextView::builder()
            .buffer(buffer)
            .wrap_mode(gtk::WrapMode::Word)
            .width_request(body_width)
            .left_margin(0)
            .right_margin(0)
            .top_margin(0)
            .bottom_margin(0)
            .build();
        text_view.add_css_class("prosa-page-editor");

        let body_scrolled = gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .vscrollbar_policy(gtk::PolicyType::Never)
            .width_request(body_width)
            .height_request(body_height)
            .child(&text_view)
            .build();

        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.add_css_class("prosa-page");
        root.set_size_request(geometry.width_px(), geometry.height_px());
        root.set_halign(gtk::Align::Center);
        root.set_valign(gtk::Align::Start);
        root.set_margin_top(0);
        body_scrolled.set_margin_top(PageGeometry::mm_to_pixels(geometry.body_top_mm(), SCREEN_DPI));
        body_scrolled.set_margin_start(PageGeometry::mm_to_pixels(geometry.margin_left_mm, SCREEN_DPI));
        body_scrolled.set_margin_end(PageGeometry::mm_to_pixels(geometry.margin_right_mm, SCREEN_DPI));
        root.append(&body_scrolled);

        let surface = Self {
            root,
            text_view,
            body_scrolled,
            index: Rc::new(Cell::new(index)),
            body_height_px: body_height,
        };
        surface.sync_viewport();
        surface
    }

    fn set_index(&self, index: usize) {
        self.index.set(index);
        self.sync_viewport();
    }

    fn sync_viewport(&self) {
        let adjustment = self.body_scrolled.vadjustment();
        let value = self.index.get() as f64 * self.body_height_px as f64;
        glib::idle_add_local_once(move || adjustment.set_value(value.min(adjustment.upper() - adjustment.page_size())));
    }

    #[allow(dead_code)] // API pública do componente e apoio aos testes GTK.
    pub fn buffer(&self) -> gtk::TextBuffer {
        self.text_view.buffer()
    }

    pub fn text_view(&self) -> gtk::TextView {
        self.text_view.clone()
    }
}

#[derive(Clone)]
pub struct PagedEditor {
    geometry: PageGeometry,
    pages_box: gtk::Box,
    scrolled: gtk::ScrolledWindow,
    pages: Rc<RefCell<Vec<PageSurface>>>,
    buffer: gtk::TextBuffer,
    repaginating: Rc<Cell<bool>>,
    debounce_source: Rc<RefCell<Option<glib::SourceId>>>,
}

impl PagedEditor {
    pub fn new(geometry: PageGeometry) -> Self {
        let pages_box = gtk::Box::new(
            gtk::Orientation::Vertical,
            PageGeometry::mm_to_pixels(geometry.page_gap_mm, SCREEN_DPI),
        );
        pages_box.add_css_class("prosa-pages");
        pages_box.set_halign(gtk::Align::Center);
        pages_box.set_valign(gtk::Align::Start);
        pages_box.set_margin_top(PageGeometry::mm_to_pixels(geometry.page_gap_mm / 2.0, SCREEN_DPI));
        pages_box.set_margin_bottom(PageGeometry::mm_to_pixels(geometry.page_gap_mm / 2.0, SCREEN_DPI));

        let scrolled = gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Automatic)
            .child(&pages_box)
            .vexpand(true)
            .build();
        scrolled.add_css_class("prosa-desk");

        let buffer = gtk::TextBuffer::new(None);
        buffer.set_enable_undo(true);
        let editor = Self {
            geometry,
            pages_box,
            scrolled,
            pages: Rc::new(RefCell::new(Vec::new())),
            buffer,
            repaginating: Rc::new(Cell::new(false)),
            debounce_source: Rc::new(RefCell::new(None)),
        };
        editor.insert_page(0);
        editor
    }

    pub fn widget(&self) -> gtk::ScrolledWindow {
        self.scrolled.clone()
    }

    pub fn page_count(&self) -> usize {
        self.pages.borrow().len()
    }

    pub fn page(&self, index: usize) -> Option<PageSurface> {
        self.pages.borrow().get(index).cloned()
    }

    pub fn is_repaginating(&self) -> bool {
        self.repaginating.get()
    }

    pub fn schedule_repaginate(&self, on_done: impl Fn() + 'static) {
        if self.repaginating.get() {
            return;
        }
        if let Some(source) = self.debounce_source.borrow_mut().take() {
            source.remove();
        }
        let editor = self.clone();
        let source = glib::timeout_add_local(Duration::from_millis(150), move || {
            *editor.debounce_source.borrow_mut() = None;
            editor.repaginate_now();
            on_done();
            glib::ControlFlow::Break
        });
        *self.debounce_source.borrow_mut() = Some(source);
    }

    pub fn repaginate_now(&self) {
        if self.repaginating.replace(true) {
            return;
        }
        let text = self.buffer.text(&self.buffer.start_iter(), &self.buffer.end_iter(), true);
        let required = page_count_for_text(&text, self.geometry);
        while self.page_count() < required {
            self.insert_page(self.page_count());
        }
        while self.page_count() > required {
            self.remove_page(self.page_count() - 1);
        }
        for (index, page) in self.pages.borrow().iter().enumerate() {
            page.set_index(index);
        }
        self.repaginating.set(false);
    }

    pub fn insert_page(&self, index: usize) -> PageSurface {
        let mut pages = self.pages.borrow_mut();
        let index = index.min(pages.len());
        let page = PageSurface::new(self.geometry, &self.buffer, index);
        let previous = index.checked_sub(1).and_then(|position| pages.get(position)).map(|page| page.root.clone());
        self.pages_box.insert_child_after(&page.root, previous.as_ref());
        pages.insert(index, page.clone());
        for (position, surface) in pages.iter().enumerate().skip(index + 1) {
            surface.set_index(position);
        }
        page
    }

    pub fn remove_page(&self, index: usize) -> Option<PageSurface> {
        let mut pages = self.pages.borrow_mut();
        if pages.len() == 1 || index >= pages.len() {
            return None;
        }
        let page = pages.remove(index);
        self.pages_box.remove(&page.root);
        for (position, surface) in pages.iter().enumerate().skip(index) {
            surface.set_index(position);
        }
        Some(page)
    }
}

fn page_count_for_text(text: &str, geometry: PageGeometry) -> usize {
    if text.is_empty() {
        return 1;
    }
    let font_map = pangocairo::FontMap::new();
    let context = font_map.create_context();
    let layout = pango::Layout::new(&context);
    layout.set_text(text);
    layout.set_width(PageGeometry::mm_to_pixels(geometry.usable_width_mm(), SCREEN_DPI) * pango::SCALE);
    let (_, logical) = layout.extents();
    let body_height = PageGeometry::mm_to_pixels(geometry.usable_height_mm(), SCREEN_DPI) * pango::SCALE;
    ((logical.height().max(1) + body_height - 1) / body_height).max(1) as usize
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn empty_editor_has_one_complete_a4_page() {
        let geometry = PageGeometry::academic_a4();
        let editor = PagedEditor::new(geometry);
        assert_eq!(editor.page_count(), 1);
        let page = editor.page(0).unwrap();
        assert_eq!(page.root.width_request(), geometry.width_px());
        assert_eq!(page.root.height_request(), geometry.height_px());
        assert_eq!(page.buffer().char_count(), 0);
    }

    pub(crate) fn pages_can_be_inserted_ordered_and_removed() {
        let editor = PagedEditor::new(PageGeometry::academic_a4());
        editor.insert_page(1);
        editor.insert_page(1);
        assert_eq!(editor.page_count(), 3);
        assert!(editor.remove_page(1).is_some());
        assert!(editor.remove_page(1).is_some());
        assert!(editor.remove_page(0).is_none());
    }

    pub(crate) fn overflow_and_underflow_repaginate_without_losing_text() {
        let editor = PagedEditor::new(PageGeometry::academic_a4());
        let original = (0..2500).map(|index| format!("linha {index}\n")).collect::<String>();
        let buffer = editor.page(0).unwrap().buffer();
        buffer.set_text(&original);
        editor.repaginate_now();
        assert!(editor.page_count() > 1);
        assert_eq!(buffer.text(&buffer.start_iter(), &buffer.end_iter(), true), original);
        buffer.set_text("curto");
        editor.repaginate_now();
        assert_eq!(editor.page_count(), 1);
    }

    pub(crate) fn pages_share_tags_selection_cursor_and_undo_history() {
        let editor = PagedEditor::new(PageGeometry::academic_a4());
        let first = editor.page(0).unwrap();
        let buffer = first.buffer();
        let original = "texto formatado ".repeat(4000);
        buffer.set_text(&original);
        let bold = gtk::TextTag::builder().name("test-bold").weight(700).build();
        buffer.tag_table().add(&bold);
        buffer.apply_tag(&bold, &buffer.iter_at_offset(6), &buffer.iter_at_offset(300));
        buffer.select_range(&buffer.iter_at_offset(10), &buffer.iter_at_offset(500));
        editor.repaginate_now();

        let last = editor.page(editor.page_count() - 1).unwrap();
        assert_eq!(first.buffer(), last.buffer());
        assert!(last.buffer().iter_at_offset(20).has_tag(&bold));
        assert_eq!(last.buffer().selection_bounds().map(|(a, b)| (a.offset(), b.offset())), Some((10, 500)));
        assert_eq!(last.buffer().text(&last.buffer().start_iter(), &last.buffer().end_iter(), true), original);
    }
}
