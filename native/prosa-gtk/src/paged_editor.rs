//! Editor paginado com um único buffer lógico e múltiplas superfícies A4.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use gtk::prelude::*;

use crate::page_geometry::{PageGeometry, SCREEN_DPI};
use crate::{formatting, pagination};

#[derive(Clone)]
pub struct PageSurface {
    root: gtk::Box,
    text_view: gtk::TextView,
    body_scrolled: gtk::ScrolledWindow,
    top_spacer: gtk::Box,
    header: gtk::Entry,
    header_bottom_spacer: gtk::Box,
    footer_row: gtk::Box,
    bottom_spacer: gtk::Box,
    page_number: gtk::Label,
    index: Rc<Cell<usize>>,
    body_height_px: Rc<Cell<i32>>,
}

impl PageSurface {
    fn new(
        geometry: PageGeometry,
        buffer: &gtk::TextBuffer,
        header_buffer: &gtk::EntryBuffer,
        footer_buffer: &gtk::EntryBuffer,
        index: usize,
    ) -> Self {
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
        let margin_left = PageGeometry::mm_to_pixels(geometry.margin_left_mm, SCREEN_DPI);
        let margin_right = PageGeometry::mm_to_pixels(geometry.margin_right_mm, SCREEN_DPI);
        let header_spacing = PageGeometry::mm_to_pixels(geometry.margin_top_mm / 2.0, SCREEN_DPI);
        let top_spacer = gtk::Box::new(gtk::Orientation::Vertical, 0);
        top_spacer.set_height_request(header_spacing);
        root.append(&top_spacer);

        let header = gtk::Entry::builder().buffer(header_buffer).has_frame(false).build();
        header.add_css_class("prosa-header-footer");
        header.set_height_request(PageGeometry::mm_to_pixels(geometry.header_height_mm, SCREEN_DPI));
        header.set_margin_start(margin_left);
        header.set_margin_end(margin_right);
        root.append(&header);
        let header_bottom_spacer = gtk::Box::new(gtk::Orientation::Vertical, 0);
        header_bottom_spacer.set_height_request(header_spacing);
        root.append(&header_bottom_spacer);

        body_scrolled.set_margin_start(margin_left);
        body_scrolled.set_margin_end(margin_right);
        root.append(&body_scrolled);

        let footer_row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        footer_row.set_height_request(PageGeometry::mm_to_pixels(geometry.footer_height_mm, SCREEN_DPI));
        footer_row.set_margin_start(margin_left);
        footer_row.set_margin_end(margin_right);
        let footer = gtk::Entry::builder().buffer(footer_buffer).has_frame(false).hexpand(true).build();
        footer.add_css_class("prosa-header-footer");
        let page_number = gtk::Label::new(None);
        page_number.add_css_class("dim-label");
        footer_row.append(&footer);
        footer_row.append(&page_number);
        root.append(&footer_row);

        let bottom_spacer = gtk::Box::new(gtk::Orientation::Vertical, 0);
        bottom_spacer.set_height_request(PageGeometry::mm_to_pixels(geometry.margin_bottom_mm, SCREEN_DPI));
        root.append(&bottom_spacer);

        let surface = Self {
            root,
            text_view,
            body_scrolled,
            top_spacer,
            header,
            header_bottom_spacer,
            footer_row,
            bottom_spacer,
            page_number,
            index: Rc::new(Cell::new(index)),
            body_height_px: Rc::new(Cell::new(body_height)),
        };
        surface.sync_viewport();
        surface
    }

    fn set_index(&self, index: usize) {
        self.index.set(index);
        self.sync_viewport();
    }

    fn set_page_number(&self, total: usize) {
        self.page_number.set_text(&format!("{} / {total}", self.index.get() + 1));
    }

    fn sync_viewport(&self) {
        let adjustment = self.body_scrolled.vadjustment();
        let value = self.index.get() as f64 * self.body_height_px.get() as f64;
        glib::idle_add_local_once(move || adjustment.set_value(value.min(adjustment.upper() - adjustment.page_size())));
    }

    fn apply_geometry(&self, geometry: PageGeometry) {
        let body_width = PageGeometry::mm_to_pixels(geometry.usable_width_mm(), SCREEN_DPI);
        let body_height = PageGeometry::mm_to_pixels(geometry.usable_height_mm(), SCREEN_DPI);
        let margin_left = PageGeometry::mm_to_pixels(geometry.margin_left_mm, SCREEN_DPI);
        let margin_right = PageGeometry::mm_to_pixels(geometry.margin_right_mm, SCREEN_DPI);
        let header_spacing = PageGeometry::mm_to_pixels(geometry.margin_top_mm / 2.0, SCREEN_DPI);
        self.root.set_size_request(geometry.width_px(), geometry.height_px());
        self.text_view.set_width_request(body_width);
        self.body_scrolled.set_size_request(body_width, body_height);
        self.body_scrolled.set_margin_start(margin_left);
        self.body_scrolled.set_margin_end(margin_right);
        self.top_spacer.set_height_request(header_spacing);
        self.header_bottom_spacer.set_height_request(header_spacing);
        self.header.set_height_request(PageGeometry::mm_to_pixels(geometry.header_height_mm, SCREEN_DPI));
        self.header.set_margin_start(margin_left);
        self.header.set_margin_end(margin_right);
        self.footer_row.set_height_request(PageGeometry::mm_to_pixels(geometry.footer_height_mm, SCREEN_DPI));
        self.footer_row.set_margin_start(margin_left);
        self.footer_row.set_margin_end(margin_right);
        self.bottom_spacer.set_height_request(PageGeometry::mm_to_pixels(geometry.margin_bottom_mm, SCREEN_DPI));
        self.body_height_px.set(body_height);
        self.sync_viewport();
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
    geometry: Rc<Cell<PageGeometry>>,
    pages_box: gtk::Box,
    scrolled: gtk::ScrolledWindow,
    pages: Rc<RefCell<Vec<PageSurface>>>,
    buffer: gtk::TextBuffer,
    header_buffer: gtk::EntryBuffer,
    footer_buffer: gtk::EntryBuffer,
    repaginating: Rc<Cell<bool>>,
    debounce_source: Rc<RefCell<Option<glib::SourceId>>>,
    active_page: Rc<Cell<usize>>,
    active_page_callbacks: Rc<RefCell<Vec<Rc<dyn Fn()>>>>,
    geometry_callbacks: Rc<RefCell<Vec<Rc<dyn Fn(PageGeometry)>>>>,
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
        let header_buffer = gtk::EntryBuffer::builder().build();
        let footer_buffer = gtk::EntryBuffer::builder().build();
        let editor = Self {
            geometry: Rc::new(Cell::new(geometry)),
            pages_box,
            scrolled,
            pages: Rc::new(RefCell::new(Vec::new())),
            buffer,
            header_buffer,
            footer_buffer,
            repaginating: Rc::new(Cell::new(false)),
            debounce_source: Rc::new(RefCell::new(None)),
            active_page: Rc::new(Cell::new(0)),
            active_page_callbacks: Rc::new(RefCell::new(Vec::new())),
            geometry_callbacks: Rc::new(RefCell::new(Vec::new())),
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

    pub fn buffer(&self) -> gtk::TextBuffer {
        self.buffer.clone()
    }

    pub fn geometry(&self) -> PageGeometry {
        self.geometry.get()
    }

    pub fn connect_geometry_changed(&self, callback: impl Fn(PageGeometry) + 'static) {
        self.geometry_callbacks.borrow_mut().push(Rc::new(callback));
    }

    pub fn preview_geometry(&self, geometry: PageGeometry) {
        self.geometry.set(geometry);
        self.pages_box.set_spacing(PageGeometry::mm_to_pixels(geometry.page_gap_mm, SCREEN_DPI));
        self.pages_box.set_margin_top(PageGeometry::mm_to_pixels(geometry.page_gap_mm / 2.0, SCREEN_DPI));
        self.pages_box.set_margin_bottom(PageGeometry::mm_to_pixels(geometry.page_gap_mm / 2.0, SCREEN_DPI));
        for page in self.pages.borrow().iter() {
            page.apply_geometry(geometry);
        }
        for callback in self.geometry_callbacks.borrow().iter() {
            callback(geometry);
        }
    }

    pub fn commit_geometry(&self, geometry: PageGeometry) {
        self.preview_geometry(geometry);
        self.repaginate_now();
    }

    pub fn active_page(&self) -> usize {
        self.active_page.get().min(self.page_count().saturating_sub(1))
    }

    pub fn connect_active_page_changed(&self, callback: impl Fn() + 'static) {
        self.active_page_callbacks.borrow_mut().push(Rc::new(callback));
    }

    pub fn page(&self, index: usize) -> Option<PageSurface> {
        self.pages.borrow().get(index).cloned()
    }

    pub fn is_repaginating(&self) -> bool {
        self.repaginating.get()
    }

    pub fn header(&self) -> Option<String> {
        non_empty(self.header_buffer.text().as_str())
    }

    pub fn footer(&self) -> Option<String> {
        non_empty(self.footer_buffer.text().as_str())
    }

    pub fn set_header_footer(&self, header: Option<&str>, footer: Option<&str>) {
        self.header_buffer.set_text(header.unwrap_or_default());
        self.footer_buffer.set_text(footer.unwrap_or_default());
    }

    pub fn connect_header_footer_changed(&self, callback: impl Fn() + 'static) {
        let callback: Rc<dyn Fn()> = Rc::new(callback);
        self.header_buffer.connect_text_notify({
            let callback = callback.clone();
            move |_| callback()
        });
        self.footer_buffer.connect_text_notify(move |_| callback());
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
        let doc = formatting::doc_from_buffer(&self.buffer);
        let geometry = self.geometry();
        let layout = pagination::layout_document(&doc, geometry);
        let required = pagination::document_page_breaks(&layout, geometry).len();
        while self.page_count() < required {
            self.insert_page(self.page_count());
        }
        while self.page_count() > required {
            self.remove_page(self.page_count() - 1);
        }
        for (index, page) in self.pages.borrow().iter().enumerate() {
            page.set_index(index);
            page.set_page_number(required);
        }
        self.repaginating.set(false);
    }

    pub fn insert_page(&self, index: usize) -> PageSurface {
        let mut pages = self.pages.borrow_mut();
        let index = index.min(pages.len());
        let page = PageSurface::new(
            self.geometry(),
            &self.buffer,
            &self.header_buffer,
            &self.footer_buffer,
            index,
        );
        page.text_view.connect_has_focus_notify({
            let active_page = self.active_page.clone();
            let callbacks = self.active_page_callbacks.clone();
            let page_index = page.index.clone();
            move |view| {
                if view.has_focus() {
                    active_page.set(page_index.get());
                    for callback in callbacks.borrow().iter() {
                        callback();
                    }
                }
            }
        });
        let previous = index.checked_sub(1).and_then(|position| pages.get(position)).map(|page| page.root.clone());
        self.pages_box.insert_child_after(&page.root, previous.as_ref());
        pages.insert(index, page.clone());
        let total = pages.len();
        for (position, surface) in pages.iter().enumerate().skip(index + 1) {
            surface.set_index(position);
        }
        for surface in pages.iter() {
            surface.set_page_number(total);
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
        let total = pages.len();
        for surface in pages.iter() {
            surface.set_page_number(total);
        }
        Some(page)
    }
}

fn non_empty(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
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

    pub(crate) fn header_and_footer_repeat_and_page_numbers_update() {
        let editor = PagedEditor::new(PageGeometry::academic_a4());
        editor.set_header_footer(Some("Título"), Some("Autor"));
        editor.insert_page(1);
        assert_eq!(editor.header().as_deref(), Some("Título"));
        assert_eq!(editor.footer().as_deref(), Some("Autor"));
        assert_eq!(editor.page(0).unwrap().page_number.text(), "1 / 2");
        assert_eq!(editor.page(1).unwrap().page_number.text(), "2 / 2");
    }

    pub(crate) fn one_long_paragraph_crosses_pages() {
        let editor = PagedEditor::new(PageGeometry::academic_a4());
        let buffer = editor.page(0).unwrap().buffer();
        let paragraph = "Uma frase longa o bastante para quebrar automaticamente na largura da folha. ".repeat(1000);
        buffer.set_text(&paragraph);
        editor.repaginate_now();
        assert!(editor.page_count() > 1, "um parágrafo sem quebras manuais deve atravessar folhas");
        assert_eq!(buffer.text(&buffer.start_iter(), &buffer.end_iter(), true), paragraph);
    }

    pub(crate) fn editing_near_a_break_reflows_both_directions() {
        let editor = PagedEditor::new(PageGeometry::academic_a4());
        let buffer = editor.page(0).unwrap().buffer();
        let content = "linha para medir a quebra\n".repeat(1000);
        buffer.set_text(&content);
        editor.repaginate_now();
        let full_pages = editor.page_count();
        assert!(full_pages > 1);

        let mut end = buffer.end_iter();
        let mut start = end.clone();
        start.backward_chars(5000);
        buffer.delete(&mut start, &mut end);
        editor.repaginate_now();
        assert!(editor.page_count() <= full_pages);
        buffer.insert_at_cursor(&content[content.len() - 5000..]);
        editor.repaginate_now();
        assert_eq!(editor.page_count(), full_pages);
        assert_eq!(buffer.text(&buffer.start_iter(), &buffer.end_iter(), true), content);
    }

    pub(crate) fn repeated_large_document_layout_converges() {
        let editor = PagedEditor::new(PageGeometry::academic_a4());
        let buffer = editor.page(0).unwrap().buffer();
        let content = "conteúdo de estresse com muitas páginas\n".repeat(1000);
        buffer.set_text(&content);
        editor.repaginate_now();
        let expected_pages = editor.page_count();
        assert!(expected_pages > 10);
        for _ in 0..10 {
            editor.repaginate_now();
            assert_eq!(editor.page_count(), expected_pages);
        }
        assert_eq!(buffer.text(&buffer.start_iter(), &buffer.end_iter(), true), content);
    }
}
