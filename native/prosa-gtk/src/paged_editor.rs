//! Componente visual responsável pela coleção ordenada de folhas A4.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use gtk::prelude::*;

use crate::page_geometry::{PageGeometry, SCREEN_DPI};

#[derive(Clone)]
pub struct PageSurface {
    root: gtk::Box,
    text_view: gtk::TextView,
}

impl PageSurface {
    fn new(geometry: PageGeometry) -> Self {
        let text_view = gtk::TextView::builder()
            .wrap_mode(gtk::WrapMode::Word)
            .top_margin(PageGeometry::mm_to_pixels(geometry.body_top_mm(), SCREEN_DPI))
            .bottom_margin(PageGeometry::mm_to_pixels(
                geometry.margin_bottom_mm + geometry.footer_height_mm,
                SCREEN_DPI,
            ))
            .left_margin(PageGeometry::mm_to_pixels(geometry.margin_left_mm, SCREEN_DPI))
            .right_margin(PageGeometry::mm_to_pixels(geometry.margin_right_mm, SCREEN_DPI))
            .hexpand(false)
            .vexpand(false)
            .build();
        text_view.add_css_class("prosa-page-editor");

        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.add_css_class("prosa-page");
        root.set_size_request(geometry.width_px(), geometry.height_px());
        root.set_halign(gtk::Align::Center);
        root.set_valign(gtk::Align::Start);
        root.append(&text_view);
        text_view.set_size_request(geometry.width_px(), geometry.height_px());

        Self { root, text_view }
    }

    #[allow(dead_code)] // Ponto de integração para fluxo/repaginação (#171).
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
    repaginating: Rc<Cell<bool>>,
    debounce_source: Rc<RefCell<Option<glib::SourceId>>>,
}

impl PagedEditor {
    pub fn new(geometry: PageGeometry) -> Self {
        let pages_box = gtk::Box::new(gtk::Orientation::Vertical, PageGeometry::mm_to_pixels(geometry.page_gap_mm, SCREEN_DPI));
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

        let editor = Self {
            geometry,
            pages_box,
            scrolled,
            pages: Rc::new(RefCell::new(Vec::new())),
            repaginating: Rc::new(Cell::new(false)),
            debounce_source: Rc::new(RefCell::new(None)),
        };
        editor.insert_page(0);
        editor
    }

    pub fn widget(&self) -> gtk::ScrolledWindow {
        self.scrolled.clone()
    }

    #[allow(dead_code)] // Consumido pela barra de status após a repaginação.
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

    fn combined_text(&self) -> String {
        self.pages
            .borrow()
            .iter()
            .map(|page| {
                let buffer = page.buffer();
                buffer.text(&buffer.start_iter(), &buffer.end_iter(), true).to_string()
            })
            .collect()
    }

    pub fn repaginate_now(&self) {
        if self.repaginating.replace(true) {
            return;
        }
        let text = self.combined_text();
        let chunks = paginate_text(&text, self.geometry);
        while self.page_count() < chunks.len() {
            self.insert_page(self.page_count());
        }
        while self.page_count() > chunks.len().max(1) {
            self.remove_page(self.page_count() - 1);
        }
        for (index, chunk) in chunks.iter().enumerate() {
            self.page(index).unwrap().buffer().set_text(chunk);
        }
        self.repaginating.set(false);
    }

    /// Insere uma folha na posição solicitada (ou no fim, se exceder o total).
    pub fn insert_page(&self, index: usize) -> PageSurface {
        let page = PageSurface::new(self.geometry);
        let mut pages = self.pages.borrow_mut();
        let index = index.min(pages.len());
        let previous = index.checked_sub(1).and_then(|position| pages.get(position)).map(|page| page.root.clone());
        self.pages_box.insert_child_after(&page.root, previous.as_ref());
        pages.insert(index, page.clone());
        page
    }

    /// Remove uma folha, preservando a invariável de ao menos uma página.
    #[allow(dead_code)] // Ponto de integração para underflow (#171).
    pub fn remove_page(&self, index: usize) -> Option<PageSurface> {
        let mut pages = self.pages.borrow_mut();
        if pages.len() == 1 || index >= pages.len() {
            return None;
        }
        let page = pages.remove(index);
        self.pages_box.remove(&page.root);
        Some(page)
    }
}

fn paginate_text(text: &str, geometry: PageGeometry) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }
    let font_map = pangocairo::FontMap::new();
    let context = font_map.create_context();
    let layout = pango::Layout::new(&context);
    layout.set_text(text);
    layout.set_width(PageGeometry::mm_to_pixels(geometry.usable_width_mm(), SCREEN_DPI) * pango::SCALE);

    let height_limit = PageGeometry::mm_to_pixels(geometry.usable_height_mm(), SCREEN_DPI) * pango::SCALE;
    let mut starts = vec![0usize];
    let mut height = 0i32;
    let mut iter = layout.iter();
    loop {
        let Some(line) = iter.line_readonly() else { break };
        let (_, logical) = line.extents();
        if height > 0 && height + logical.height() > height_limit {
            starts.push(line.start_index() as usize);
            height = 0;
        }
        height += logical.height();
        if !iter.next_line() {
            break;
        }
    }

    starts
        .iter()
        .enumerate()
        .map(|(index, start)| {
            let end = starts.get(index + 1).copied().unwrap_or(text.len());
            text[*start..end].to_string()
        })
        .collect()
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
        let second = editor.insert_page(1);
        second.buffer().set_text("segunda");
        let middle = editor.insert_page(1);
        middle.buffer().set_text("meio");
        assert_eq!(editor.page_count(), 3);
        assert_eq!(editor.page(1).unwrap().buffer().text(&middle.buffer().start_iter(), &middle.buffer().end_iter(), false), "meio");
        assert!(editor.remove_page(1).is_some());
        assert_eq!(editor.page_count(), 2);
        assert!(editor.remove_page(1).is_some());
        assert!(editor.remove_page(0).is_none(), "a última folha não pode ser removida");
    }

    pub(crate) fn overflow_and_underflow_repaginate_without_losing_text() {
        let editor = PagedEditor::new(PageGeometry::academic_a4());
        let original = (0..2500).map(|index| format!("linha {index}\n")).collect::<String>();
        editor.page(0).unwrap().buffer().set_text(&original);
        editor.repaginate_now();
        assert!(editor.page_count() > 1);
        assert_eq!(editor.combined_text(), original);

        editor.page(0).unwrap().buffer().set_text("curto");
        for index in 1..editor.page_count() {
            editor.page(index).unwrap().buffer().set_text("");
        }
        editor.repaginate_now();
        assert_eq!(editor.page_count(), 1);
        assert_eq!(editor.combined_text(), "curto");
    }
}
