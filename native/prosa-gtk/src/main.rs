//! Prosa nativo — casca GTK4 + libadwaita (MVP).
//!
//! Cobre o escopo do MVP da migração: shell nativo, editor de texto rico
//! sobre `GtkTextView` (negrito/itálico/sublinhado/tachado, títulos H1-H3,
//! localizar/substituir, corretor ortográfico, IA assistida) e abrir/salvar
//! o formato `.prosa` existente. Sem tabelas nem imagens ainda — isso é
//! trabalho das fases seguintes (ver issues da epic "Migração do Prosa
//! para Rust + GTK4").

mod ai_ui;
mod bibliography_ui;
mod citation;
mod color_style;
mod find_replace;
mod font_style;
mod formatting;
mod graph_view;
mod outline;
mod page_geometry;
mod paged_editor;
mod pagination;
mod print;
mod save_format;
mod spellcheck;
mod sync_ui;
mod template_dialog;
mod version_history_ui;
mod wikilink;

use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, gio, glib};
use prosa_doc::{docx, odt, rtf};
use prosa_doc::{sync_watcher, version_history, DocumentMetadata, ProsaFile};

use find_replace::{FindReplace, SearchOptions};
use save_format::SaveFormat;
use formatting::{current_line, doc_from_buffer, load_doc_into_buffer, set_heading_level, set_line_alignment, setup_align_tags, setup_heading_tags, setup_mark_tags, toggle_mark};
use spellcheck::{LiveSpellcheck, SpellChecker};

const APP_ID: &str = "br.com.rodrigobrito.Prosa.Native";

/// Conta palavras (separadas por espaço em branco) e frases (fim de frase
/// `.`/`!`/`?`, tratando pontuação repetida como um único fim).
fn count_words_and_sentences(text: &str) -> (usize, usize) {
    let words = text.split_whitespace().count();
    let mut sentences = 0usize;
    let mut in_sentence_end = false;
    for character in text.chars() {
        match character {
            '.' | '!' | '?' if !in_sentence_end => {
                sentences += 1;
                in_sentence_end = true;
            }
            '.' | '!' | '?' => {}
            character if character.is_whitespace() => {}
            _ => in_sentence_end = false,
        }
    }
    (words, sentences)
}

/// Estado do documento atualmente aberto na janela.
struct DocumentState {
    path: Option<PathBuf>,
    metadata: DocumentMetadata,
    /// HTML de cabeçalho/rodapé carregado de um `.prosa` existente. A UI
    /// nativa ainda não permite editá-los — são só preservados ao salvar e
    /// usados (como texto puro) na exportação para PDF.
    header: Option<String>,
    footer: Option<String>,
    paged_editor: paged_editor::PagedEditor,
    /// Formato do `path` atual (se houver). Some salva silenciosamente nesse
    /// formato de novo; sem `path` ainda, o botão Salvar pergunta o formato
    /// (ver `save_format::show_format_picker`), igual à versão Electron.
    format: SaveFormat,
}

/// Painel lateral de backlinks: documentos, dentro da pasta de workspace
/// escolhida na sessão (ver `prosa_doc::workspace`), que referenciam o
/// documento atualmente aberto via `[[wikilink]]`. `workspace_root` não é
/// persistido — dura só a sessão, igual decidido pra essa primeira versão.
#[derive(Clone)]
struct BacklinksPanel {
    workspace_root: Rc<RefCell<Option<PathBuf>>>,
    workspace_label: gtk::Label,
    list: gtk::ListBox,
    paths: Rc<RefCell<Vec<PathBuf>>>,
}

impl BacklinksPanel {
    fn clear_list(&self) {
        while let Some(row) = self.list.row_at_index(0) {
            self.list.remove(&row);
        }
        self.paths.borrow_mut().clear();
    }

    fn append_info_row(&self, text: &str) {
        let label = gtk::Label::builder().label(text).xalign(0.0).wrap(true).margin_start(8).margin_end(8).margin_top(6).margin_bottom(6).css_classes(["dim-label"]).build();
        self.list.append(&label);
    }

    /// Recalcula e redesenha a lista de backlinks para `current_path` (o
    /// documento aberto no momento). Roda a varredura da pasta inteira do
    /// zero a cada chamada — sem cache/índice persistido, igual à versão
    /// Electron (`workspace.ts`).
    fn refresh(&self, current_path: Option<&Path>) {
        self.clear_list();

        let Some(root) = self.workspace_root.borrow().clone() else {
            self.workspace_label.set_text("Nenhuma pasta de workspace selecionada.");
            return;
        };
        self.workspace_label.set_text(&format!("Workspace: {}", root.display()));

        let Some(current_path) = current_path else {
            self.append_info_row("Salve o documento pra ver backlinks.");
            return;
        };

        let docs = prosa_doc::workspace::scan_workspace(&root);
        let relations = prosa_doc::workspace::relations_for(&root, current_path, &docs);

        if relations.backlinks.is_empty() {
            self.append_info_row("Nenhum documento referencia este ainda.");
            return;
        }

        let mut paths = self.paths.borrow_mut();
        for doc in &relations.backlinks {
            let label = gtk::Label::builder().label(&doc.title).xalign(0.0).margin_start(8).margin_end(8).margin_top(4).margin_bottom(4).build();
            self.list.append(&label);
            paths.push(doc.path.clone());
        }
    }
}

fn now_iso() -> String {
    glib::DateTime::now_utc()
        .and_then(|dt| dt.format_iso8601())
        .map(|s| s.to_string())
        .unwrap_or_default()
}

fn new_document_state(paged_editor: paged_editor::PagedEditor) -> DocumentState {
    DocumentState {
        path: None,
        metadata: DocumentMetadata {
            title: "Sem título".to_string(),
            author: whoami_fallback(),
            created_at: now_iso(),
            modified_at: now_iso(),
        },
        header: None,
        footer: None,
        paged_editor,
        format: SaveFormat::Prosa,
    }
}

/// Melhor esforço para um nome de autor padrão, sem depender de crates extras.
fn whoami_fallback() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default()
}

fn prosa_file_filter() -> gtk::FileFilter {
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("Documento Prosa (.prosa)"));
    filter.add_suffix("prosa");
    filter
}

fn docx_file_filter() -> gtk::FileFilter {
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("Word (.docx)"));
    filter.add_suffix("docx");
    filter
}

fn odt_file_filter() -> gtk::FileFilter {
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("OpenDocument (.odt)"));
    filter.add_suffix("odt");
    filter
}

fn rtf_file_filter() -> gtk::FileFilter {
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("Rich Text (.rtf)"));
    filter.add_suffix("rtf");
    filter
}

/// Nome do arquivo sem extensão, usado como título quando um `.docx`/`.odt`/
/// `.rtf` (que não carregam metadados como o `.prosa`) é aberto.
fn file_stem_title(path: &std::path::Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Sem título".to_string())
}

/// Refaz a busca a partir do estado atual dos campos/opções e atualiza o
/// contador "N/total" — chamado a cada mudança no termo, nas opções, ou
/// depois de qualquer substituição.
#[allow(clippy::too_many_arguments)]
fn refresh_search(
    buffer: &gtk::TextBuffer,
    find_replace: &Rc<RefCell<FindReplace>>,
    search_entry: &gtk::SearchEntry,
    case_toggle: &gtk::ToggleButton,
    whole_word_toggle: &gtk::ToggleButton,
    regex_toggle: &gtk::ToggleButton,
    match_position_label: &gtk::Label,
) {
    let options = SearchOptions {
        case_sensitive: case_toggle.is_active(),
        whole_word: whole_word_toggle.is_active(),
        regex: regex_toggle.is_active(),
    };
    let mut fr = find_replace.borrow_mut();
    fr.search(buffer, &search_entry.text(), options);
    let total = fr.match_count();
    let current = fr.current_position().unwrap_or(0);
    match_position_label.set_text(&format!("{current}/{total}"));
}

/// Reconstrói a lista do painel de tópicos a partir dos títulos atuais do
/// buffer, guardando a linha de cada item em `outline_lines` (na mesma
/// ordem/índice das linhas do `GtkListBox`) pra navegação no clique.
fn refresh_outline(buffer: &gtk::TextBuffer, outline_list: &gtk::ListBox, outline_lines: &Rc<RefCell<Vec<i32>>>) {
    while let Some(row) = outline_list.row_at_index(0) {
        outline_list.remove(&row);
    }
    let entries = outline::build_outline(buffer);
    let mut lines = outline_lines.borrow_mut();
    lines.clear();
    for entry in entries {
        let label = gtk::Label::builder()
            .label(format!("{} {}", entry.number, entry.text))
            .xalign(0.0)
            .margin_start((entry.level as i32 - 1) * 12 + 8)
            .margin_top(4)
            .margin_bottom(4)
            .margin_end(8)
            .ellipsize(pango::EllipsizeMode::End)
            .build();
        outline_list.append(&label);
        lines.push(entry.line);
    }
}

/// Atualiza a barra de status do editor contínuo. A contagem de páginas só
/// voltará quando houver folhas reais gerenciadas pelo `PagedEditor`.
fn update_status_bar(buffer: &gtk::TextBuffer, pages: usize, label: &gtk::Label) {
    let (start, end) = buffer.bounds();
    let text = buffer.text(&start, &end, false);
    let (words, sentences) = count_words_and_sentences(&text);
    label.set_text(&format!(
        "{words} palavra{} · {sentences} frase{} · {pages} página{}",
        if words == 1 { "" } else { "s" },
        if sentences == 1 { "" } else { "s" },
        if pages == 1 { "" } else { "s" },
    ));
}

/// Palavra sob um clique do menu de contexto, com o suficiente pra
/// substituí-la por uma sugestão ou adicioná-la ao dicionário.
#[derive(Clone)]
struct PendingMisspelling {
    word: String,
    start_offset: i32,
    end_offset: i32,
    suggestions: Vec<String>,
}

/// Palavra sob o iterador dado, usando os limites de palavra nativos do
/// GTK (podem incluir números/apóstrofos — mais permissivo que a
/// tokenização por caracteres alfabéticos que `spellcheck::find_misspelled_ranges`
/// usa pro sublinhado; a diferença nas bordas é aceitável aqui, é só pra
/// resolver "qual palavra o usuário clicou").
fn word_at_iter(buffer: &gtk::TextBuffer, iter: &gtk::TextIter) -> Option<(String, i32, i32)> {
    if !iter.inside_word() {
        return None;
    }
    let mut start = iter.clone();
    if !start.starts_word() {
        start.backward_word_start();
    }
    let mut end = iter.clone();
    if !end.ends_word() {
        end.forward_word_end();
    }
    let word = buffer.text(&start, &end, false).to_string();
    if word.is_empty() {
        return None;
    }
    Some((word, start.offset(), end.offset()))
}

/// Abre um documento (`.prosa`/`.docx`/`.odt`/`.rtf`) num caminho já
/// conhecido, carregando-o no buffer e atualizando o estado — compartilhado
/// pelo botão "Abrir" e pelo clique numa linha do painel de backlinks.
fn open_document_at_path(
    window: &adw::ApplicationWindow,
    buffer: &gtk::TextBuffer,
    title_widget: &adw::WindowTitle,
    state: &Rc<RefCell<DocumentState>>,
    loading_document: &Rc<Cell<bool>>,
    backlinks: &BacklinksPanel,
    path: PathBuf,
) {
    let extension = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();

    let opened = match extension.as_str() {
        "docx" | "odt" | "rtf" => read_foreign_document(&path, &extension).map(|content| {
            let now = now_iso();
            let metadata =
                DocumentMetadata { title: file_stem_title(&path), author: String::new(), created_at: now.clone(), modified_at: now };
            (content, metadata, None, None)
        }),
        _ => ProsaFile::load(&path).map_err(|e| e.to_string()).map(|f| (f.content, f.metadata, f.header, f.footer)),
    };

    match opened {
        Ok((content, metadata, header, footer)) => {
            loading_document.set(true);
            load_doc_into_buffer(buffer, &content);
            loading_document.set(false);
            title_widget.set_subtitle(&metadata.title);
            let format = SaveFormat::from_extension(&extension).unwrap_or(SaveFormat::Prosa);
            let paged_editor = state.borrow().paged_editor.clone();
            paged_editor.set_header_footer(header.as_deref(), footer.as_deref());
            *state.borrow_mut() = DocumentState { path: Some(path.clone()), metadata, header, footer, paged_editor, format };
            backlinks.refresh(Some(&path));
        }
        Err(message) => {
            let alert = adw::AlertDialog::new(Some("Não foi possível abrir o documento"), Some(&message));
            alert.add_response("ok", "OK");
            alert.present(Some(window));
        }
    }
}

/// Substitui o buffer pelo conteúdo de `template` (ou por um documento
/// vazio, se `None` — "Em branco") e reseta o estado do documento como
/// novo, sem caminho. Igual ao `open_document_at_path`, mas partindo de um
/// template em vez de um arquivo em disco.
fn apply_new_document(
    buffer: &gtk::TextBuffer,
    title_widget: &adw::WindowTitle,
    state: &Rc<RefCell<DocumentState>>,
    loading_document: &Rc<Cell<bool>>,
    backlinks: &BacklinksPanel,
    template: Option<prosa_doc::templates::DocumentTemplate>,
) {
    let content = template.as_ref().map(|t| t.content.clone()).unwrap_or_else(prosa_doc::TipTapNode::empty_doc);
    let title = template.as_ref().map(|t| t.name.to_string()).unwrap_or_else(|| "Sem título".to_string());
    let format = template.as_ref().and_then(|t| SaveFormat::from_extension(t.preferred_format)).unwrap_or(SaveFormat::Prosa);

    loading_document.set(true);
    load_doc_into_buffer(buffer, &content);
    let paged_editor = state.borrow().paged_editor.clone();
    paged_editor.set_header_footer(None, None);
    loading_document.set(false);

    title_widget.set_subtitle(&title);
    *state.borrow_mut() = DocumentState {
        path: None,
        metadata: DocumentMetadata { title, author: whoami_fallback(), created_at: now_iso(), modified_at: now_iso() },
        header: None,
        footer: None,
        paged_editor,
        format,
    };
    backlinks.refresh(None);
}

/// Restaura um snapshot do histórico de versões (`version_history_ui`) como
/// conteúdo do editor. Mantém `path`/`format` do documento atual — restaurar
/// não muda onde/como o arquivo é salvo, só o conteúdo/metadados/cabeçalho/
/// rodapé. Antes de substituir o buffer, grava uma cópia de segurança do
/// estado atual (mesmo mecanismo de `write_document`), pra restaurar não ser
/// uma operação destrutiva sem volta.
fn restore_version(
    buffer: &gtk::TextBuffer,
    title_widget: &adw::WindowTitle,
    state: &Rc<RefCell<DocumentState>>,
    loading_document: &Rc<Cell<bool>>,
    backlinks: &BacklinksPanel,
    path: &Path,
    restored: ProsaFile,
) {
    let safety_snapshot = {
        let current = state.borrow();
        ProsaFile { version: 1, content: doc_from_buffer(buffer), metadata: current.metadata.clone(), notes: None, header: current.header.clone(), footer: current.footer.clone() }
    };
    let _ = version_history::create_backup(path, &safety_snapshot, version_history::DEFAULT_KEEP_VERSIONS, now_iso());

    loading_document.set(true);
    load_doc_into_buffer(buffer, &restored.content);
    state.borrow().paged_editor.set_header_footer(restored.header.as_deref(), restored.footer.as_deref());
    loading_document.set(false);

    title_widget.set_subtitle(&restored.metadata.title);
    {
        let mut current = state.borrow_mut();
        current.metadata = restored.metadata;
        current.header = restored.header;
        current.footer = restored.footer;
    }
    backlinks.refresh(Some(path));
}

/// (Re)inicia o `sync_watcher` pra `root` — descarta o observador anterior
/// primeiro (dropar o `Watcher` já para a observação), depois cria um novo
/// se `root` for `Some`. Mesmo padrão do `setupSyncWatcher` original:
/// idempotente, seguro de chamar de novo a qualquer momento (escolher outra
/// pasta, desativar).
fn restart_sync_watcher(handle: &Rc<RefCell<Option<sync_watcher::Watcher>>>, tx: &std::sync::mpsc::Sender<sync_watcher::SyncEvent>, root: Option<PathBuf>) {
    *handle.borrow_mut() = None;
    let Some(root) = root else { return };
    match sync_watcher::start_watching(&root, tx.clone()) {
        Ok(watcher) => *handle.borrow_mut() = Some(watcher),
        Err(err) => eprintln!("aviso: não foi possível observar a pasta de sincronização ({}): {err}", root.display()),
    }
}

/// Caminho "canonicalizado, com fallback pro original se falhar" — usado
/// pra comparar o caminho de um evento externo com o do documento aberto
/// sem depender de igualdade de string bruta (frágil entre plataformas,
/// forma como o Electron original comparava). Falha de canonicalização é
/// esperada pra eventos de remoção (o arquivo já não existe mais).
fn canonical_or_self(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Lê um documento em formato estrangeiro (`docx`/`odt`/`rtf`) pela extensão.
fn read_foreign_document(path: &std::path::Path, extension: &str) -> Result<prosa_doc::TipTapNode, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    match extension {
        "docx" => docx::read_docx(&bytes).map_err(|e| e.to_string()),
        "odt" => odt::read_odt(&bytes).map_err(|e| e.to_string()),
        "rtf" => rtf::read_rtf(&bytes).map_err(|e| e.to_string()),
        other => Err(format!("formato não suportado: {other}")),
    }
}

/// Aparência transitória do editor contínuo enquanto o `PagedEditor` ainda
/// não foi introduzido. Não há folhas, quebras nem widgets sobre o texto.
fn install_page_css() {
    let provider = gtk::CssProvider::new();
    provider.load_from_string(
        "box.prosa-page, textview.prosa-page-editor, textview.prosa-page-editor text { background-color: #ffffff; color: #1a1a1a; }\n\
         entry.prosa-header-footer, entry.prosa-header-footer text { background-color: #ffffff; color: #555555; box-shadow: none; }\n\
         entry.prosa-header-footer:focus { color: #1a1a1a; }\n\
         scrolledwindow.prosa-desk { background-color: #2e2e2e; }",
    );
    if let Some(display) = gtk::gdk::Display::default() {
        gtk::style_context_add_provider_for_display(&display, &provider, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);
    }
}

fn build_window(app: &adw::Application) {
    install_page_css();

    let page_geometry = page_geometry::PageGeometry::academic_a4();
    let paged_editor = paged_editor::PagedEditor::new(page_geometry);
    let text_view = paged_editor.page(0).expect("PagedEditor sempre contém uma folha").text_view();
    let buffer = text_view.buffer();
    setup_mark_tags(&buffer);
    setup_heading_tags(&buffer);
    setup_align_tags(&buffer);
    wikilink::setup_wikilink_tag(&buffer);

    let spellchecker = Rc::new(SpellChecker::new());
    let live_spellcheck = Rc::new(LiveSpellcheck::new(spellchecker.clone()));
    if !spellchecker.is_available() {
        eprintln!("aviso: nenhum dicionário de corretor ortográfico encontrado (pt_BR/en_US) — sublinhado desativado");
    }

    let status_label = gtk::Label::builder().xalign(0.0).margin_start(12).margin_end(12).margin_top(4).margin_bottom(4).build();
    status_label.add_css_class("dim-label");

    let state = Rc::new(RefCell::new(new_document_state(paged_editor.clone())));
    // `load_doc_into_buffer` insere o documento inteiro de uma vez — sem essa
    // guarda, qualquer "[[...]]" literal (texto de fontes que não usam a
    // convenção de wikilink) viraria link sozinho só de abrir o arquivo. A
    // detecção deve valer só pra quem está digitando, não pra carga em massa.
    let loading_document = Rc::new(Cell::new(false));
    paged_editor.connect_header_footer_changed(glib::clone!(
        #[strong]
        state,
        #[strong]
        loading_document,
        #[strong]
        paged_editor,
        move || {
            if loading_document.get() {
                return;
            }
            let mut current = state.borrow_mut();
            current.header = paged_editor.header();
            current.footer = paged_editor.footer();
        }
    ));

    let title_widget = adw::WindowTitle::new("Prosa", "Sem título");

    let new_button = gtk::Button::from_icon_name("document-new-symbolic");
    new_button.set_tooltip_text(Some("Novo documento"));
    let open_button = gtk::Button::from_icon_name("document-open-symbolic");
    open_button.set_tooltip_text(Some("Abrir (.prosa ou .docx)"));
    let save_button = gtk::Button::from_icon_name("media-floppy-symbolic");
    save_button.set_tooltip_text(Some("Salvar"));

    let bold_button = gtk::Button::from_icon_name("format-text-bold-symbolic");
    bold_button.set_tooltip_text(Some("Negrito (Ctrl+B)"));
    let italic_button = gtk::Button::from_icon_name("format-text-italic-symbolic");
    italic_button.set_tooltip_text(Some("Itálico (Ctrl+I)"));
    let underline_button = gtk::Button::from_icon_name("format-text-underline-symbolic");
    underline_button.set_tooltip_text(Some("Sublinhado (Ctrl+U)"));
    let strike_button = gtk::Button::from_icon_name("format-text-strikethrough-symbolic");
    strike_button.set_tooltip_text(Some("Tachado"));
    // Sem ícone simbólico padrão pra sobrescrito/subscrito no tema Adwaita —
    // rótulo de texto, mesmo padrão já usado nos botões da barra de
    // localizar/substituir ("Aa", ".*", "Palavra").
    let superscript_button = gtk::Button::with_label("x²");
    superscript_button.set_tooltip_text(Some("Sobrescrito"));
    let subscript_button = gtk::Button::with_label("x₂");
    subscript_button.set_tooltip_text(Some("Subscrito"));
    let text_color_button = gtk::ColorDialogButton::new(Some(gtk::ColorDialog::builder().title("Cor do texto").build()));
    text_color_button.set_tooltip_text(Some("Cor do texto selecionado"));
    text_color_button.set_rgba(&gdk::RGBA::BLACK);
    let highlight_button = gtk::ColorDialogButton::new(Some(gtk::ColorDialog::builder().title("Cor do realce").build()));
    highlight_button.set_tooltip_text(Some("Realçar texto selecionado"));
    highlight_button.set_rgba(&gdk::RGBA::parse("#FFF59D").expect("cor padrão válida"));

    let heading_menu = gio::Menu::new();
    heading_menu.append(Some("Título 1"), Some("win.heading-1"));
    heading_menu.append(Some("Título 2"), Some("win.heading-2"));
    heading_menu.append(Some("Título 3"), Some("win.heading-3"));
    heading_menu.append(Some("Parágrafo normal"), Some("win.heading-none"));
    let heading_menu_button =
        gtk::MenuButton::builder().label("H").tooltip_text("Título do parágrafo").menu_model(&heading_menu).build();

    // Alinhamento de parágrafo: grupo próprio de botões simples (não
    // `ToggleButton`) — mesmo padrão de negrito/itálico/etc, sem tentar
    // sincronizar um estado "ativo" com a posição do cursor (o menu de
    // título ao lado também não faz isso).
    let align_left_button = gtk::Button::from_icon_name("format-justify-left-symbolic");
    align_left_button.set_tooltip_text(Some("Alinhar à esquerda"));
    let align_center_button = gtk::Button::from_icon_name("format-justify-center-symbolic");
    align_center_button.set_tooltip_text(Some("Centralizar"));
    let align_right_button = gtk::Button::from_icon_name("format-justify-right-symbolic");
    align_right_button.set_tooltip_text(Some("Alinhar à direita"));
    let align_justify_button = gtk::Button::from_icon_name("format-justify-fill-symbolic");
    align_justify_button.set_tooltip_text(Some("Justificar"));

    let outline_toggle_button = gtk::ToggleButton::builder().icon_name("view-list-symbolic").tooltip_text("Painel de tópicos").build();
    let backlinks_toggle_button = gtk::ToggleButton::builder().icon_name("insert-link-symbolic").tooltip_text("Backlinks").build();
    let graph_button = gtk::Button::from_icon_name("network-workgroup-symbolic");
    graph_button.set_tooltip_text(Some("Grafo de conexões"));
    // Sem ícone simbólico de "livro/bibliografia" no tema Adwaita — rótulo
    // de texto, mesmo padrão de "H"/"Aa"/"IA" já usado no resto da barra.
    let bibliography_button = gtk::Button::with_label("Bib");
    bibliography_button.set_tooltip_text(Some("Bibliografia"));
    let history_button = gtk::Button::from_icon_name("document-open-recent-symbolic");
    history_button.set_tooltip_text(Some("Histórico de versões"));
    let sync_button = gtk::Button::from_icon_name("folder-remote-symbolic");
    sync_button.set_tooltip_text(Some("Sincronização"));

    // Família e tamanho de fonte: dois seletores independentes, igual ao
    // Electron (`fontSelect`/`sizeSelect` em `toolbar.ts`), mas a lista de
    // famílias vem direto do Pango (`font_style::system_font_families`) em
    // vez de precisar de um IPC pra consultar fontes do sistema. O seletor
    // de família é montado à mão (popover + busca + lista) em vez de um
    // `GtkDropDown` — ver o comentário em `font_style::build_family_picker`.
    let font_families = font_style::system_font_families();
    let font_family_button = font_style::build_family_picker(&buffer, &font_families);

    // Índice 0 é um marcador "em branco" (nenhum tamanho definido, ou
    // seleção com mais de um tamanho misturado) — os tamanhos de verdade
    // começam no índice 1, ver `sync_font_pickers` mais abaixo.
    let mut font_size_entries: Vec<String> = vec!["—".to_string()];
    font_size_entries.extend(font_style::FONT_SIZES.iter().map(|size| size.to_string()));
    let font_size_labels: Rc<Vec<String>> = Rc::new(font_size_entries);
    let font_size_refs: Vec<&str> = font_size_labels.iter().map(String::as_str).collect();
    let font_size_dropdown = gtk::DropDown::from_strings(&font_size_refs);
    font_size_dropdown.set_tooltip_text(Some("Tamanho da fonte"));

    // Suprime o `connect_selected_notify` do tamanho quando *nós* mudamos a
    // seleção pra refletir o estado atual (ver abaixo) — sem isso, sincronizar
    // a UI reaplicaria um tamanho sobre a seleção só por causa da própria
    // sincronização.
    let syncing_font_ui = Rc::new(Cell::new(false));

    let ai_provider: ai_ui::AiSelectedProvider = Rc::new(Cell::new(prosa_doc::ai::AiProvider::OpenAi));

    let ai_menu = gio::Menu::new();
    let ai_actions_section = gio::Menu::new();
    for index in 0..ai_ui::ACTIONS_MENU.len() {
        let (label, _) = ai_ui::ACTIONS_MENU[index];
        ai_actions_section.append(Some(label), Some(&format!("win.ai-action-{index}")));
    }
    ai_menu.append_section(None, &ai_actions_section);
    let ai_settings_section = gio::Menu::new();
    ai_settings_section.append(Some("Configurar IA..."), Some("win.ai-settings"));
    ai_menu.append_section(None, &ai_settings_section);
    let ai_menu_button = gtk::MenuButton::builder().label("IA").tooltip_text("Ações de IA").menu_model(&ai_menu).build();

    // "document-export-symbolic" não existe no tema Adwaita padrão — o botão
    // aciona a exportação via GtkPrintOperation (print.rs), então o ícone de
    // impressora é o correto semanticamente, além de existir de fato.
    let export_pdf_button = gtk::Button::from_icon_name("document-print-symbolic");
    export_pdf_button.set_tooltip_text(Some("Exportar PDF"));

    // Grupos "linked" (mesmo padrão HIG do GNOME de agrupar botões
    // relacionados numa pílula só) em vez de uma fileira flat de itens
    // soltos: arquivo, formatação de texto e navegação/IA ficam visualmente
    // separados uns dos outros.
    let file_group = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    file_group.add_css_class("linked");
    file_group.append(&new_button);
    file_group.append(&open_button);
    file_group.append(&save_button);

    let format_group = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    format_group.add_css_class("linked");
    format_group.append(&bold_button);
    format_group.append(&italic_button);
    format_group.append(&underline_button);
    format_group.append(&strike_button);
    format_group.append(&superscript_button);
    format_group.append(&subscript_button);
    format_group.append(&text_color_button);
    format_group.append(&highlight_button);
    format_group.append(&heading_menu_button);

    let align_group = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    align_group.add_css_class("linked");
    align_group.append(&align_left_button);
    align_group.append(&align_center_button);
    align_group.append(&align_right_button);
    align_group.append(&align_justify_button);

    let nav_group = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    nav_group.add_css_class("linked");
    nav_group.append(&outline_toggle_button);
    nav_group.append(&backlinks_toggle_button);
    nav_group.append(&graph_button);
    nav_group.append(&bibliography_button);
    nav_group.append(&history_button);
    nav_group.append(&sync_button);
    nav_group.append(&ai_menu_button);

    let font_group = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    font_group.add_css_class("linked");
    font_group.append(&font_family_button);
    font_group.append(&font_size_dropdown);

    let header_bar = adw::HeaderBar::builder().title_widget(&title_widget).build();
    header_bar.pack_start(&file_group);
    header_bar.pack_start(&gtk::Separator::new(gtk::Orientation::Vertical));
    header_bar.pack_start(&format_group);
    header_bar.pack_start(&gtk::Separator::new(gtk::Orientation::Vertical));
    header_bar.pack_start(&align_group);
    // Confirmado empiricamente (não documentado nos headers do GTK): pra
    // `pack_end`, cada chamada nova entra mais perto do título do que as
    // anteriores — a *última* chamada acaba encostada nele, a *primeira*
    // fica na borda direita da janela. `nav_group` (tópicos/backlinks/
    // grafo/bibliografia/histórico/IA) foi movido do lado esquerdo (antes
    // do título) pro direito a pedido do usuário; `font_group` (fonte/
    // tamanho), pedido logo em seguida na mesma sessão, entra ainda mais
    // perto do título do que `nav_group`.
    header_bar.pack_end(&export_pdf_button);
    header_bar.pack_end(&gtk::Separator::new(gtk::Orientation::Vertical));
    header_bar.pack_end(&nav_group);
    header_bar.pack_end(&gtk::Separator::new(gtk::Orientation::Vertical));
    header_bar.pack_end(&font_group);

    // Barra de localizar/substituir: escondida por padrão, revelada com
    // Ctrl+F. Um único bloco cobrindo busca e substituição (em vez das
    // duas linhas condicionais do Electron) — mais simples de manter.
    let search_entry = gtk::SearchEntry::builder().placeholder_text("Localizar").hexpand(true).build();
    let replace_entry = gtk::Entry::builder().placeholder_text("Substituir por").hexpand(true).build();
    let match_position_label = gtk::Label::builder().label("0/0").css_classes(["dim-label"]).width_chars(6).build();
    let find_prev_button = gtk::Button::from_icon_name("go-up-symbolic");
    find_prev_button.set_tooltip_text(Some("Anterior (Shift+Enter)"));
    let find_next_button = gtk::Button::from_icon_name("go-down-symbolic");
    find_next_button.set_tooltip_text(Some("Próximo (Enter)"));
    let case_toggle = gtk::ToggleButton::builder().label("Aa").tooltip_text("Diferenciar maiúsculas/minúsculas").build();
    let whole_word_toggle = gtk::ToggleButton::builder().label("Palavra").tooltip_text("Palavra inteira").build();
    let regex_toggle = gtk::ToggleButton::builder().label(".*").tooltip_text("Expressão regular").build();
    let replace_button = gtk::Button::with_label("Substituir");
    let replace_all_button = gtk::Button::with_label("Substituir todas");
    let find_close_button = gtk::Button::from_icon_name("window-close-symbolic");
    find_close_button.set_tooltip_text(Some("Fechar (Esc)"));

    let find_row = gtk::Box::builder().orientation(gtk::Orientation::Horizontal).spacing(6).build();
    find_row.append(&search_entry);
    find_row.append(&match_position_label);
    find_row.append(&find_prev_button);
    find_row.append(&find_next_button);
    find_row.append(&case_toggle);
    find_row.append(&whole_word_toggle);
    find_row.append(&regex_toggle);
    find_row.append(&find_close_button);

    let replace_row = gtk::Box::builder().orientation(gtk::Orientation::Horizontal).spacing(6).build();
    replace_row.append(&replace_entry);
    replace_row.append(&replace_button);
    replace_row.append(&replace_all_button);

    let find_bar = gtk::Box::builder()
        .orientation(gtk::Orientation::Vertical)
        .spacing(6)
        .margin_top(8)
        .margin_bottom(8)
        .margin_start(12)
        .margin_end(12)
        .build();
    find_bar.append(&find_row);
    find_bar.append(&replace_row);

    let find_bar_revealer = gtk::Revealer::builder().transition_type(gtk::RevealerTransitionType::SlideDown).child(&find_bar).build();

    let find_replace = Rc::new(RefCell::new(FindReplace::default()));
    let outline_lines: Rc<RefCell<Vec<i32>>> = Rc::new(RefCell::new(Vec::new()));

    // Painel de tópicos: lista de títulos (H1-H3) do documento, clicável
    // pra navegar. Escondido por padrão, revelado pelo botão da toolbar.
    let outline_list = gtk::ListBox::new();
    outline_list.add_css_class("navigation-sidebar");
    outline_list.set_selection_mode(gtk::SelectionMode::None);
    let outline_scrolled = gtk::ScrolledWindow::builder().child(&outline_list).vexpand(true).width_request(220).build();
    let outline_revealer =
        gtk::Revealer::builder().transition_type(gtk::RevealerTransitionType::SlideRight).reveal_child(false).child(&outline_scrolled).build();

    // Painel de backlinks: documentos (dentro da pasta de workspace
    // escolhida na sessão) que referenciam o documento atual via
    // `[[wikilink]]`. Escondido por padrão, revelado pelo botão da toolbar.
    let workspace_label = gtk::Label::builder()
        .label("Nenhuma pasta de workspace selecionada.")
        .xalign(0.0)
        .wrap(true)
        .margin_start(8)
        .margin_end(8)
        .margin_top(8)
        .css_classes(["dim-label"])
        .build();
    let choose_workspace_button =
        gtk::Button::builder().label("Escolher pasta...").margin_start(8).margin_end(8).margin_top(4).margin_bottom(8).build();
    let backlinks_list = gtk::ListBox::new();
    backlinks_list.add_css_class("navigation-sidebar");
    backlinks_list.set_selection_mode(gtk::SelectionMode::None);

    let backlinks_box = gtk::Box::new(gtk::Orientation::Vertical, 0);
    backlinks_box.append(&workspace_label);
    backlinks_box.append(&choose_workspace_button);
    backlinks_box.append(&gtk::Separator::new(gtk::Orientation::Horizontal));
    backlinks_box.append(&backlinks_list);
    let backlinks_scrolled = gtk::ScrolledWindow::builder().child(&backlinks_box).vexpand(true).width_request(240).build();
    let backlinks_revealer =
        gtk::Revealer::builder().transition_type(gtk::RevealerTransitionType::SlideLeft).reveal_child(false).child(&backlinks_scrolled).build();

    let backlinks = BacklinksPanel {
        workspace_root: Rc::new(RefCell::new(None)),
        workspace_label: workspace_label.clone(),
        list: backlinks_list.clone(),
        paths: Rc::new(RefCell::new(Vec::new())),
    };

    // Pasta de sincronização (`sync_watcher`) — conceito à parte do
    // workspace acima: destinada a serviços externos (Dropbox/Drive), não
    // ao escaneio de wikilinks. Session-only, mesma decisão do workspace
    // root (sem persistência de configurações no app nativo ainda).
    let sync_root: Rc<RefCell<Option<PathBuf>>> = Rc::new(RefCell::new(None));
    let sync_watcher_handle: Rc<RefCell<Option<sync_watcher::Watcher>>> = Rc::new(RefCell::new(None));
    let sync_guard: Rc<RefCell<sync_watcher::SelfWriteGuard>> = Rc::new(RefCell::new(sync_watcher::SelfWriteGuard::default()));
    let (sync_tx, sync_rx) = std::sync::mpsc::channel::<sync_watcher::SyncEvent>();

    let toast_overlay = adw::ToastOverlay::new();

    // Mantém a barra de status fora da área rolável do editor.
    let content_box = gtk::Box::new(gtk::Orientation::Vertical, 0);
    content_box.set_hexpand(true);
    content_box.append(&paged_editor.widget());
    content_box.append(&status_label);

    let main_split = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    main_split.append(&outline_revealer);
    main_split.append(&gtk::Separator::new(gtk::Orientation::Vertical));
    main_split.append(&content_box);
    main_split.append(&gtk::Separator::new(gtk::Orientation::Vertical));
    main_split.append(&backlinks_revealer);

    let toolbar_view = adw::ToolbarView::new();
    toolbar_view.add_top_bar(&header_bar);
    toolbar_view.add_top_bar(&find_bar_revealer);
    toolbar_view.set_content(Some(&main_split));

    toast_overlay.set_child(Some(&toolbar_view));

    let window = adw::ApplicationWindow::builder()
        .application(app)
        .title("Prosa")
        .default_width(900)
        .default_height(700)
        .maximized(true)
        .content(&toast_overlay)
        .build();

    bold_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| toggle_mark(&buffer, "bold")
    ));
    italic_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| toggle_mark(&buffer, "italic")
    ));
    underline_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| toggle_mark(&buffer, "underline")
    ));
    strike_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| toggle_mark(&buffer, "strike")
    ));
    superscript_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| toggle_mark(&buffer, "superscript")
    ));
    subscript_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| toggle_mark(&buffer, "subscript")
    ));
    text_color_button.connect_rgba_notify(glib::clone!(
        #[weak]
        buffer,
        move |button| color_style::apply_color(&buffer, &button.rgba(), false)
    ));
    highlight_button.connect_rgba_notify(glib::clone!(
        #[weak]
        buffer,
        move |button| color_style::apply_color(&buffer, &button.rgba(), true)
    ));

    align_left_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| set_line_alignment(&buffer, current_line(&buffer), None)
    ));
    align_center_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| set_line_alignment(&buffer, current_line(&buffer), Some("center"))
    ));
    align_right_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| set_line_alignment(&buffer, current_line(&buffer), Some("right"))
    ));
    align_justify_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        move |_| set_line_alignment(&buffer, current_line(&buffer), Some("justify"))
    ));

    // Tamanho aplica sobre a seleção atual (não a linha inteira, ao
    // contrário de título/alinhamento) — se nada estiver selecionado,
    // `apply_font_style` simplesmente não faz nada, mesma guarda usada em
    // `citation::apply_citation`. Família é tratada dentro de
    // `font_style::build_family_picker` (a ativação de um item da lista já
    // aplica direto), não precisa de handler aqui.
    font_size_dropdown.connect_selected_notify(glib::clone!(
        #[weak]
        buffer,
        #[strong]
        font_size_labels,
        #[strong]
        syncing_font_ui,
        move |dropdown| {
            if syncing_font_ui.get() {
                return;
            }
            let index = dropdown.selected() as usize;
            if index == 0 {
                return; // marcador "em branco", não é um tamanho de verdade
            }
            if let Some(size) = font_size_labels.get(index) {
                font_style::apply_font_style(&buffer, None, Some(size));
            }
        }
    ));

    // Ao mover o cursor ou mudar a seleção, reflete a família/tamanho ativos
    // nos dois seletores — em branco se a seleção misturar mais de um
    // (`font_style::active_family`/`active_size` já fazem essa checagem).
    buffer.connect_notify_local(
        Some("cursor-position"),
        glib::clone!(
            #[weak]
            font_family_button,
            #[weak]
            font_size_dropdown,
            #[strong]
            font_size_labels,
            #[strong]
            syncing_font_ui,
            move |buffer, _| {
                let family = font_style::active_family(buffer);
                font_family_button.set_label(family.as_deref().unwrap_or("Fonte"));

                let size = font_style::active_size(buffer);
                let index = size.and_then(|value| font_size_labels.iter().position(|label| *label == value)).unwrap_or(0);
                syncing_font_ui.set(true);
                font_size_dropdown.set_selected(index as u32);
                syncing_font_ui.set(false);
            }
        ),
    );

    outline_toggle_button.connect_toggled(glib::clone!(
        #[weak]
        outline_revealer,
        move |button| outline_revealer.set_reveal_child(button.is_active())
    ));

    backlinks_toggle_button.connect_toggled(glib::clone!(
        #[weak]
        backlinks_revealer,
        #[strong]
        backlinks,
        #[strong]
        state,
        move |button| {
            let active = button.is_active();
            backlinks_revealer.set_reveal_child(active);
            if active {
                backlinks.refresh(state.borrow().path.as_deref());
            }
        }
    ));

    choose_workspace_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[strong]
        backlinks,
        #[strong]
        state,
        move |_| {
            let dialog = gtk::FileDialog::builder().title("Escolher pasta do workspace").modal(true).build();
            glib::spawn_future_local(glib::clone!(
                #[weak]
                window,
                #[strong]
                backlinks,
                #[strong]
                state,
                async move {
                    let Ok(folder) = dialog.select_folder_future(Some(&window)).await else { return };
                    let Some(path) = folder.path() else { return };
                    *backlinks.workspace_root.borrow_mut() = Some(path);
                    backlinks.refresh(state.borrow().path.as_deref());
                }
            ));
        }
    ));

    backlinks_list.connect_row_activated(glib::clone!(
        #[weak]
        window,
        #[weak]
        buffer,
        #[weak]
        title_widget,
        #[strong]
        state,
        #[strong]
        loading_document,
        #[strong]
        backlinks,
        move |_, row| {
            if let Some(path) = backlinks.paths.borrow().get(row.index() as usize).cloned() {
                open_document_at_path(&window, &buffer, &title_widget, &state, &loading_document, &backlinks, path);
            }
        }
    ));

    graph_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[weak]
        buffer,
        #[weak]
        title_widget,
        #[strong]
        state,
        #[strong]
        loading_document,
        #[strong]
        backlinks,
        move |_| {
            let Some(root) = backlinks.workspace_root.borrow().clone() else {
                let alert = adw::AlertDialog::new(
                    Some("Nenhum workspace selecionado"),
                    Some("Escolha uma pasta de workspace no painel de backlinks antes de abrir o grafo."),
                );
                alert.add_response("ok", "OK");
                alert.present(Some(&window));
                return;
            };
            graph_view::open_graph_window(
                &window,
                root,
                glib::clone!(
                    #[weak]
                    window,
                    #[weak]
                    buffer,
                    #[weak]
                    title_widget,
                    #[strong]
                    state,
                    #[strong]
                    loading_document,
                    #[strong]
                    backlinks,
                    move |path| open_document_at_path(&window, &buffer, &title_widget, &state, &loading_document, &backlinks, path)
                ),
            );
        }
    ));

    bibliography_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[weak]
        buffer,
        #[strong]
        backlinks,
        move |_| {
            bibliography_ui::open_bibliography_dialog(&window, &buffer, &backlinks.workspace_root);
        }
    ));

    history_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[weak]
        buffer,
        #[weak]
        title_widget,
        #[strong]
        state,
        #[strong]
        loading_document,
        #[strong]
        backlinks,
        move |_| {
            let path = state.borrow().path.clone();
            let on_restore: Rc<dyn Fn(ProsaFile)> = Rc::new(glib::clone!(
                #[weak]
                buffer,
                #[weak]
                title_widget,
                #[strong]
                state,
                #[strong]
                loading_document,
                #[strong]
                backlinks,
                #[strong]
                path,
                move |restored: ProsaFile| {
                    if let Some(path) = &path {
                        restore_version(&buffer, &title_widget, &state, &loading_document, &backlinks, path, restored);
                    }
                }
            ));
            version_history_ui::open_version_history_dialog(&window, &buffer, path, on_restore);
        }
    ));

    sync_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[strong]
        sync_root,
        #[strong]
        sync_watcher_handle,
        #[strong]
        sync_tx,
        move |_| {
            let on_change: Rc<dyn Fn(Option<PathBuf>)> = Rc::new(glib::clone!(
                #[strong]
                sync_watcher_handle,
                #[strong]
                sync_tx,
                move |root: Option<PathBuf>| restart_sync_watcher(&sync_watcher_handle, &sync_tx, root)
            ));
            sync_ui::open_sync_settings_dialog(&window, &sync_root, on_change);
        }
    ));

    outline_list.connect_row_activated(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        text_view,
        #[strong]
        outline_lines,
        move |_, row| {
            if let Some(&line) = outline_lines.borrow().get(row.index() as usize) {
                let mut iter = buffer.iter_at_line(line).unwrap_or_else(|| buffer.start_iter());
                buffer.place_cursor(&iter);
                text_view.scroll_to_iter(&mut iter, 0.0, true, 0.0, 0.1);
            }
        }
    ));

    for (action_name, level) in [("heading-1", Some(1u8)), ("heading-2", Some(2)), ("heading-3", Some(3)), ("heading-none", None)] {
        let action = gio::SimpleAction::new(action_name, None);
        action.connect_activate(glib::clone!(
            #[weak]
            buffer,
            #[weak]
            outline_list,
            #[strong]
            outline_lines,
            #[weak]
            status_label,
            #[strong]
            paged_editor,
            move |_, _| {
                set_heading_level(&buffer, current_line(&buffer), level);
                // Aplicar/remover a tag de título não dispara `changed` (só
                // inserir/remover conteúdo faz isso), então o esboço precisa
                // ser atualizado explicitamente.
                refresh_outline(&buffer, &outline_list, &outline_lines);
                update_status_bar(&buffer, paged_editor.page_count(), &status_label);
            }
        ));
        window.add_action(&action);
    }

    let key_controller = gtk::EventControllerKey::new();
    key_controller.connect_key_pressed(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        find_bar_revealer,
        #[weak]
        search_entry,
        #[upgrade_or]
        glib::Propagation::Proceed,
        move |_, keyval, _keycode, modifiers| {
            if modifiers.contains(gdk::ModifierType::CONTROL_MASK) {
                let lower = keyval.to_lower();
                if lower == gdk::Key::f {
                    find_bar_revealer.set_reveal_child(true);
                    search_entry.grab_focus();
                    return glib::Propagation::Stop;
                }
                let mark_name = if lower == gdk::Key::b {
                    Some("bold")
                } else if lower == gdk::Key::i {
                    Some("italic")
                } else if lower == gdk::Key::u {
                    Some("underline")
                } else {
                    None
                };
                if let Some(name) = mark_name {
                    toggle_mark(&buffer, name);
                    return glib::Propagation::Stop;
                }
            }
            glib::Propagation::Proceed
        }
    ));
    text_view.add_controller(key_controller);

    for toggle in [&case_toggle, &whole_word_toggle, &regex_toggle] {
        toggle.connect_toggled(glib::clone!(
            #[weak]
            buffer,
            #[strong]
            find_replace,
            #[weak]
            search_entry,
            #[weak]
            case_toggle,
            #[weak]
            whole_word_toggle,
            #[weak]
            regex_toggle,
            #[weak]
            match_position_label,
            move |_| refresh_search(&buffer, &find_replace, &search_entry, &case_toggle, &whole_word_toggle, &regex_toggle, &match_position_label)
        ));
    }

    search_entry.connect_search_changed(glib::clone!(
        #[weak]
        buffer,
        #[strong]
        find_replace,
        #[weak]
        search_entry,
        #[weak]
        case_toggle,
        #[weak]
        whole_word_toggle,
        #[weak]
        regex_toggle,
        #[weak]
        match_position_label,
        move |_| refresh_search(&buffer, &find_replace, &search_entry, &case_toggle, &whole_word_toggle, &regex_toggle, &match_position_label)
    ));

    // Enter simples = próximo match (via "activate" da GtkSearchEntry).
    search_entry.connect_activate(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        text_view,
        #[strong]
        find_replace,
        #[weak]
        match_position_label,
        move |_| {
            let mut fr = find_replace.borrow_mut();
            if let Some(mut iter) = fr.go_next(&buffer) {
                text_view.scroll_to_iter(&mut iter, 0.0, true, 0.0, 0.3);
            }
            let total = fr.match_count();
            let current = fr.current_position().unwrap_or(0);
            match_position_label.set_text(&format!("{current}/{total}"));
        }
    ));

    // Shift+Enter = anterior; Esc = fecha a barra. GtkSearchEntry não
    // distingue Shift no "activate", então precisa de um controlador de
    // tecla à parte.
    let search_key_controller = gtk::EventControllerKey::new();
    search_key_controller.connect_key_pressed(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        text_view,
        #[strong]
        find_replace,
        #[weak]
        match_position_label,
        #[weak]
        find_bar_revealer,
        #[upgrade_or]
        glib::Propagation::Proceed,
        move |_, keyval, _keycode, modifiers| {
            if keyval == gdk::Key::Escape {
                find_bar_revealer.set_reveal_child(false);
                find_replace.borrow_mut().clear(&buffer);
                text_view.grab_focus();
                return glib::Propagation::Stop;
            }
            if keyval == gdk::Key::Return && modifiers.contains(gdk::ModifierType::SHIFT_MASK) {
                let mut fr = find_replace.borrow_mut();
                if let Some(mut iter) = fr.go_previous(&buffer) {
                    text_view.scroll_to_iter(&mut iter, 0.0, true, 0.0, 0.3);
                }
                let total = fr.match_count();
                let current = fr.current_position().unwrap_or(0);
                match_position_label.set_text(&format!("{current}/{total}"));
                return glib::Propagation::Stop;
            }
            glib::Propagation::Proceed
        }
    ));
    search_entry.add_controller(search_key_controller);

    find_next_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        text_view,
        #[strong]
        find_replace,
        #[weak]
        match_position_label,
        move |_| {
            let mut fr = find_replace.borrow_mut();
            if let Some(mut iter) = fr.go_next(&buffer) {
                text_view.scroll_to_iter(&mut iter, 0.0, true, 0.0, 0.3);
            }
            let total = fr.match_count();
            let current = fr.current_position().unwrap_or(0);
            match_position_label.set_text(&format!("{current}/{total}"));
        }
    ));
    find_prev_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        text_view,
        #[strong]
        find_replace,
        #[weak]
        match_position_label,
        move |_| {
            let mut fr = find_replace.borrow_mut();
            if let Some(mut iter) = fr.go_previous(&buffer) {
                text_view.scroll_to_iter(&mut iter, 0.0, true, 0.0, 0.3);
            }
            let total = fr.match_count();
            let current = fr.current_position().unwrap_or(0);
            match_position_label.set_text(&format!("{current}/{total}"));
        }
    ));

    replace_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        #[strong]
        find_replace,
        #[weak]
        replace_entry,
        #[weak]
        search_entry,
        #[weak]
        case_toggle,
        #[weak]
        whole_word_toggle,
        #[weak]
        regex_toggle,
        #[weak]
        match_position_label,
        move |_| {
            find_replace.borrow().replace_current(&buffer, &replace_entry.text());
            refresh_search(&buffer, &find_replace, &search_entry, &case_toggle, &whole_word_toggle, &regex_toggle, &match_position_label);
        }
    ));
    replace_all_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        #[strong]
        find_replace,
        #[weak]
        replace_entry,
        #[weak]
        search_entry,
        #[weak]
        case_toggle,
        #[weak]
        whole_word_toggle,
        #[weak]
        regex_toggle,
        #[weak]
        match_position_label,
        move |_| {
            find_replace.borrow().replace_all(&buffer, &replace_entry.text());
            refresh_search(&buffer, &find_replace, &search_entry, &case_toggle, &whole_word_toggle, &regex_toggle, &match_position_label);
        }
    ));

    find_close_button.connect_clicked(glib::clone!(
        #[weak]
        buffer,
        #[weak]
        text_view,
        #[strong]
        find_replace,
        #[weak]
        find_bar_revealer,
        move |_| {
            find_bar_revealer.set_reveal_child(false);
            find_replace.borrow_mut().clear(&buffer);
            text_view.grab_focus();
        }
    ));

    // Menu de contexto do corretor ortográfico: GtkTextView só expõe um
    // `extra-menu` estático (GMenuModel), não um sinal dinâmico tipo
    // "populate-popup" — então a palavra sob o clique é resolvida na mão,
    // num gesto na fase de *captura* (roda antes do menu nativo abrir), e
    // o `extra-menu` é reconstruído ali mesmo.
    let pending_misspelling: Rc<RefCell<Option<PendingMisspelling>>> = Rc::new(RefCell::new(None));

    let spellcheck_actions = gio::SimpleActionGroup::new();
    for index in 0..spellcheck::MAX_SUGGESTIONS {
        let action = gio::SimpleAction::new(&format!("suggest-{index}"), None);
        action.connect_activate(glib::clone!(
            #[weak]
            buffer,
            #[strong]
            pending_misspelling,
            move |_, _| {
                let Some(pending) = pending_misspelling.borrow().clone() else { return };
                if let Some(suggestion) = pending.suggestions.get(index) {
                    let mut start = buffer.iter_at_offset(pending.start_offset);
                    let mut end = buffer.iter_at_offset(pending.end_offset);
                    buffer.delete(&mut start, &mut end);
                    buffer.insert(&mut start, suggestion);
                }
            }
        ));
        spellcheck_actions.add_action(&action);
    }
    let add_word_action = gio::SimpleAction::new("add-word", None);
    add_word_action.connect_activate(glib::clone!(
        #[weak]
        buffer,
        #[strong]
        pending_misspelling,
        #[strong]
        spellchecker,
        #[strong]
        live_spellcheck,
        move |_, _| {
            let Some(pending) = pending_misspelling.borrow().clone() else { return };
            spellchecker.add_to_dictionary(&pending.word);
            live_spellcheck.schedule_recompute(&buffer);
        }
    ));
    spellcheck_actions.add_action(&add_word_action);
    text_view.insert_action_group("spellcheck", Some(&spellcheck_actions));

    let right_click = gtk::GestureClick::new();
    right_click.set_button(3);
    right_click.set_propagation_phase(gtk::PropagationPhase::Capture);
    right_click.connect_pressed(glib::clone!(
        #[weak]
        text_view,
        #[weak]
        buffer,
        #[strong]
        spellchecker,
        #[strong]
        pending_misspelling,
        move |_, _n_press, x, y| {
            *pending_misspelling.borrow_mut() = None;
            let menu = gio::Menu::new();

            let (buffer_x, buffer_y) = text_view.window_to_buffer_coords(gtk::TextWindowType::Widget, x as i32, y as i32);
            if let Some(iter) = text_view.iter_at_location(buffer_x, buffer_y) {
                if let Some((word, start_offset, end_offset)) = word_at_iter(&buffer, &iter) {
                    if spellchecker.is_available() && !spellchecker.check(&word) {
                        let suggestions = spellchecker.suggest(&word);
                        if suggestions.is_empty() {
                            menu.append(Some("Nenhuma sugestão"), None::<&str>);
                        } else {
                            for (index, suggestion) in suggestions.iter().enumerate() {
                                menu.append(Some(suggestion), Some(&format!("spellcheck.suggest-{index}")));
                            }
                        }
                        menu.append(Some("Adicionar ao dicionário"), Some("spellcheck.add-word"));
                        *pending_misspelling.borrow_mut() =
                            Some(PendingMisspelling { word, start_offset, end_offset, suggestions });
                    }
                }
            }
            text_view.set_extra_menu(Some(&menu));
        }
    ));
    text_view.add_controller(right_click);

    update_status_bar(&buffer, paged_editor.page_count(), &status_label);
    refresh_outline(&buffer, &outline_list, &outline_lines);
    buffer.connect_changed(glib::clone!(
        #[weak]
        text_view,
        #[weak]
        buffer,
        #[weak]
        status_label,
        #[strong]
        live_spellcheck,
        #[weak]
        outline_list,
        #[strong]
        outline_lines,
        #[strong]
        loading_document,
        #[strong]
        paged_editor,
        move |_| {
            if !loading_document.get() {
                wikilink::linkify_pending(&buffer);
            }
            // Acompanha o cursor ao digitar — sem isso, digitar perto do fim
            // da área visível não rola a tela sozinho (o comportamento
            // automático do GtkTextView não é confiável dentro do
            // GtkOverlay/margens customizadas da folha).
            text_view.scroll_mark_onscreen(&buffer.get_insert());
            update_status_bar(&buffer, paged_editor.page_count(), &status_label);
            refresh_outline(&buffer, &outline_list, &outline_lines);
            live_spellcheck.schedule_recompute(&buffer);
            if !paged_editor.is_repaginating() {
                paged_editor.schedule_repaginate(glib::clone!(
                    #[weak]
                    buffer,
                    #[weak]
                    status_label,
                    #[strong]
                    paged_editor,
                    move || update_status_bar(&buffer, paged_editor.page_count(), &status_label)
                ));
            }
        }
    ));

    new_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[weak]
        buffer,
        #[weak]
        title_widget,
        #[strong]
        state,
        #[strong]
        loading_document,
        #[strong]
        backlinks,
        move |_| {
            template_dialog::show_template_picker(
                &window,
                glib::clone!(
                    #[weak]
                    buffer,
                    #[weak]
                    title_widget,
                    #[strong]
                    state,
                    #[strong]
                    loading_document,
                    #[strong]
                    backlinks,
                    move |template| {
                        apply_new_document(&buffer, &title_widget, &state, &loading_document, &backlinks, template);
                    }
                ),
            );
        }
    ));

    open_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[weak]
        buffer,
        #[weak]
        title_widget,
        #[strong]
        state,
        #[strong]
        loading_document,
        #[strong]
        backlinks,
        move |_| {
            let dialog = gtk::FileDialog::builder()
                .title("Abrir documento")
                .modal(true)
                .build();
            let filters = gio::ListStore::new::<gtk::FileFilter>();
            filters.append(&prosa_file_filter());
            filters.append(&docx_file_filter());
            filters.append(&odt_file_filter());
            filters.append(&rtf_file_filter());
            dialog.set_filters(Some(&filters));

            glib::spawn_future_local(glib::clone!(
                #[weak]
                window,
                #[weak]
                buffer,
                #[weak]
                title_widget,
                #[strong]
                state,
                #[strong]
                loading_document,
                #[strong]
                backlinks,
                async move {
                    let file = match dialog.open_future(Some(&window)).await {
                        Ok(file) => file,
                        Err(_) => return, // cancelado pelo usuário
                    };
                    let Some(path) = file.path() else { return };
                    open_document_at_path(&window, &buffer, &title_widget, &state, &loading_document, &backlinks, path);
                }
            ));
        }
    ));

    // "Salvar" espelha `DocumentPersistenceController.save` do Electron:
    // documento já tem caminho -> grava direto, sem perguntar de novo, no
    // mesmo formato de sempre; documento novo (sem caminho ainda) -> pergunta
    // o formato primeiro (`save_format::show_format_picker`), só depois abre
    // o seletor de arquivo.
    save_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[weak]
        buffer,
        #[weak]
        title_widget,
        #[strong]
        state,
        #[strong]
        backlinks,
        #[strong]
        sync_guard,
        move |_| {
            let existing = state.borrow().path.clone();
            if let Some(path) = existing {
                let format = state.borrow().format;
                write_document(&window, &buffer, &title_widget, &state, &backlinks, &sync_guard, path, format);
                return;
            }

            save_format::show_format_picker(
                &window,
                glib::clone!(
                    #[weak]
                    window,
                    #[weak]
                    buffer,
                    #[weak]
                    title_widget,
                    #[strong]
                    state,
                    #[strong]
                    backlinks,
                    #[strong]
                    sync_guard,
                    move |format: SaveFormat| {
                        let default_name = format!("{}.{}", state.borrow().metadata.title, format.extension());
                        let dialog = gtk::FileDialog::builder()
                            .title("Salvar como")
                            .modal(true)
                            .initial_name(default_name)
                            .build();
                        let filters = gio::ListStore::new::<gtk::FileFilter>();
                        filters.append(&file_filter_for_format(format));
                        dialog.set_filters(Some(&filters));

                        glib::spawn_future_local(glib::clone!(
                            #[weak]
                            window,
                            #[weak]
                            buffer,
                            #[weak]
                            title_widget,
                            #[strong]
                            state,
                            #[strong]
                            backlinks,
                            #[strong]
                            sync_guard,
                            async move {
                                let Ok(file) = dialog.save_future(Some(&window)).await else { return };
                                let Some(path) = file.path() else { return };
                                write_document(&window, &buffer, &title_widget, &state, &backlinks, &sync_guard, path, format);
                            }
                        ));
                    }
                ),
            );
        }
    ));

    export_pdf_button.connect_clicked(glib::clone!(
        #[weak]
        window,
        #[weak]
        buffer,
        #[strong]
        state,
        move |_| {
            let default_name = format!("{}.pdf", state.borrow().metadata.title);
            let dialog = gtk::FileDialog::builder()
                .title("Exportar PDF")
                .modal(true)
                .initial_name(default_name)
                .build();
            let filters = gio::ListStore::new::<gtk::FileFilter>();
            let pdf_filter = gtk::FileFilter::new();
            pdf_filter.set_name(Some("PDF"));
            pdf_filter.add_suffix("pdf");
            filters.append(&pdf_filter);
            dialog.set_filters(Some(&filters));

            glib::spawn_future_local(glib::clone!(
                #[weak]
                window,
                #[weak]
                buffer,
                #[strong]
                state,
                async move {
                    let Ok(file) = dialog.save_future(Some(&window)).await else { return };
                    let Some(path) = file.path() else { return };

                    let doc = doc_from_buffer(&buffer);
                    let current = state.borrow();
                    let result = print::export_to_pdf(
                        &window,
                        &path,
                        &doc,
                        current.header.as_deref(),
                        current.footer.as_deref(),
                    );
                    drop(current);

                    if let Err(err) = result {
                        let alert = adw::AlertDialog::new(
                            Some("Não foi possível exportar o PDF"),
                            Some(&err.to_string()),
                        );
                        alert.add_response("ok", "OK");
                        alert.present(Some(&window));
                    }
                }
            ));
        }
    ));

    let ai_settings_action = gio::SimpleAction::new("ai-settings", None);
    ai_settings_action.connect_activate(glib::clone!(
        #[weak]
        window,
        #[strong]
        ai_provider,
        move |_, _| ai_ui::open_settings_dialog(&window, &ai_provider)
    ));
    window.add_action(&ai_settings_action);

    for index in 0..ai_ui::ACTIONS_MENU.len() {
        let action = gio::SimpleAction::new(&format!("ai-action-{index}"), None);
        action.connect_activate(glib::clone!(
            #[weak]
            window,
            #[weak]
            buffer,
            #[strong]
            ai_provider,
            move |_, _| {
                let (_, ai_action) = ai_ui::ACTIONS_MENU[index];
                ai_ui::run_action(&window, &buffer, ai_provider.get(), ai_action);
            }
        ));
        window.add_action(&action);
    }

    // Drena os `SyncEvent`s do `sync_watcher` periodicamente — mais simples
    // e robusto do que caçar uma API de canal específica do `glib` pra
    // acordar só quando há evento (o intervalo curto já é barato: só
    // esvazia um `mpsc::Receiver`, sem I/O). Só reage a mudanças no
    // documento atualmente aberto; tudo mais na pasta de sincronização é
    // ignorado, igual ao original.
    glib::timeout_add_local(
        std::time::Duration::from_millis(400),
        glib::clone!(
            #[weak]
            window,
            #[weak]
            buffer,
            #[weak]
            title_widget,
            #[strong]
            state,
            #[strong]
            loading_document,
            #[strong]
            backlinks,
            #[strong]
            sync_guard,
            #[weak]
            toast_overlay,
            #[upgrade_or]
            glib::ControlFlow::Break,
            move || {
                while let Ok(event) = sync_rx.try_recv() {
                    if sync_guard.borrow_mut().should_ignore(&event.path) {
                        continue;
                    }
                    let Some(current_path) = state.borrow().path.clone() else { continue };
                    if canonical_or_self(&event.path) != canonical_or_self(&current_path) {
                        continue;
                    }
                    let file_name = current_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

                    match event.kind {
                        sync_watcher::SyncChangeKind::Modified => {
                            let toast = adw::Toast::new(&format!("\"{file_name}\" foi alterado pela sincronização."));
                            toast.set_button_label(Some("Recarregar"));
                            toast.connect_button_clicked(glib::clone!(
                                #[weak]
                                window,
                                #[weak]
                                buffer,
                                #[weak]
                                title_widget,
                                #[strong]
                                state,
                                #[strong]
                                loading_document,
                                #[strong]
                                backlinks,
                                #[strong]
                                current_path,
                                move |_| open_document_at_path(&window, &buffer, &title_widget, &state, &loading_document, &backlinks, current_path.clone())
                            ));
                            toast_overlay.add_toast(toast);
                        }
                        // Sem "recarregar" aqui — não há mais nada em disco
                        // pra ler. O Electron original nem chegava a notar
                        // exclusão externa (só tratava o evento `change` do
                        // chokidar); avisar é uma melhoria deliberada, não
                        // paridade.
                        sync_watcher::SyncChangeKind::Removed => {
                            toast_overlay.add_toast(adw::Toast::new(&format!("\"{file_name}\" foi removido pela sincronização.")));
                        }
                    }
                }
                glib::ControlFlow::Continue
            }
        ),
    );

    window.present();
}

fn file_filter_for_format(format: SaveFormat) -> gtk::FileFilter {
    match format {
        SaveFormat::Prosa => prosa_file_filter(),
        SaveFormat::Docx => docx_file_filter(),
        SaveFormat::Odt => odt_file_filter(),
        SaveFormat::Rtf => rtf_file_filter(),
    }
}

/// Serializa o buffer no formato escolhido e grava em `path`; em caso de
/// sucesso, esse formato e caminho passam a ser os "atuais" do documento
/// (próximo Ctrl+S grava direto neles, sem perguntar de novo).
fn write_document(
    window: &adw::ApplicationWindow,
    buffer: &gtk::TextBuffer,
    title_widget: &adw::WindowTitle,
    state: &Rc<RefCell<DocumentState>>,
    backlinks: &BacklinksPanel,
    sync_guard: &Rc<RefCell<sync_watcher::SelfWriteGuard>>,
    path: PathBuf,
    format: SaveFormat,
) {
    let doc = doc_from_buffer(buffer);
    let mut current = state.borrow_mut();
    current.metadata.modified_at = now_iso();

    let result: Result<(), String> = match format {
        SaveFormat::Prosa => {
            let prosa_file = ProsaFile {
                version: 1,
                content: doc.clone(),
                metadata: current.metadata.clone(),
                notes: None,
                header: current.header.clone(),
                footer: current.footer.clone(),
            };
            prosa_file.save(&path).map_err(|e| e.to_string())
        }
        SaveFormat::Docx => {
            docx::write_docx(&doc).map_err(|e| e.to_string()).and_then(|bytes| std::fs::write(&path, bytes).map_err(|e| e.to_string()))
        }
        SaveFormat::Odt => {
            odt::write_odt(&doc).map_err(|e| e.to_string()).and_then(|bytes| std::fs::write(&path, bytes).map_err(|e| e.to_string()))
        }
        SaveFormat::Rtf => std::fs::write(&path, rtf::write_rtf(&doc)).map_err(|e| e.to_string()),
    };

    match result {
        Ok(()) => {
            // Backup automático a cada salvamento, igual ao original
            // (`backup-service.ts`), mas sempre com a representação
            // canônica `.prosa` do conteúdo — independe do formato de
            // exportação escolhido (docx/odt/rtf também acionam backup).
            let snapshot =
                ProsaFile { version: 1, content: doc, metadata: current.metadata.clone(), notes: None, header: current.header.clone(), footer: current.footer.clone() };
            let _ = version_history::create_backup(&path, &snapshot, version_history::DEFAULT_KEEP_VERSIONS, now_iso());

            // Marca o caminho como "acabamos de escrever nós mesmos" —
            // sem isso o próprio `sync_watcher` reportaria esse save como
            // se fosse uma mudança externa (mesmo `markSelfWrite` do
            // original, chamado incondicionalmente após todo save).
            sync_guard.borrow_mut().mark(&path);

            title_widget.set_subtitle(&current.metadata.title);
            current.path = Some(path.clone());
            current.format = format;
            drop(current);
            backlinks.refresh(Some(&path));
        }
        Err(err) => {
            drop(current);
            let alert = adw::AlertDialog::new(Some("Não foi possível salvar o documento"), Some(&err));
            alert.add_response("ok", "OK");
            alert.present(Some(window));
        }
    }
}

/// Por padrão, libadwaita já segue claro/escuro do sistema (via portal
/// freedesktop). Se não der pra identificar nenhuma DE, força escuro em vez
/// de cair no claro (fallback do próprio GTK quando o portal não existe).
fn apply_theme_fallback() {
    let has_known_desktop = std::env::var("XDG_CURRENT_DESKTOP").is_ok_and(|v| !v.is_empty())
        || std::env::var("DESKTOP_SESSION").is_ok_and(|v| !v.is_empty());
    if !has_known_desktop {
        adw::StyleManager::default().set_color_scheme(adw::ColorScheme::ForceDark);
    }
}

fn main() -> glib::ExitCode {
    let app = adw::Application::builder().application_id(APP_ID).build();
    app.connect_activate(|app| {
        apply_theme_fallback();
        build_window(app);
    });
    app.run()
}

/// GTK só aceita ser inicializado numa única thread do processo, mas o
/// harness padrão do Rust roda cada `#[test]` em sua própria thread — por
/// isso todos os testes que tocam GTK (deste e dos outros módulos) são
/// chamados a partir deste único `#[test]`, em vez de terem o atributo cada
/// um no seu módulo.
#[cfg(test)]
mod tests {
    #[test]
    fn counts_words_and_sentences() {
        assert_eq!(super::count_words_and_sentences("Olá mundo. Tudo bem? Sim!"), (5, 3));
        assert_eq!(super::count_words_and_sentences("Pensando... talvez."), (2, 2));
        assert_eq!(super::count_words_and_sentences(""), (0, 0));
    }

    #[test]
    fn all_gtk_dependent_tests() {
        let _ = gtk::init();
        crate::formatting::tests::round_trip_preserves_marks();
        crate::formatting::tests::multiple_paragraphs_round_trip();
        crate::formatting::tests::toggle_mark_applies_and_removes();
        crate::formatting::tests::heading_round_trips_with_level();
        crate::formatting::tests::heading_levels_above_three_are_clamped_down();
        crate::formatting::tests::set_heading_level_toggles_between_paragraph_and_heading();
        crate::formatting::tests::alignment_round_trips_and_is_orthogonal_to_heading();
        crate::formatting::tests::set_line_alignment_toggles_between_values_and_back_to_left();
        crate::formatting::tests::color_and_highlight_round_trip();
        crate::outline::tests::numbers_headings_hierarchically_and_resets_on_level_up();
        crate::outline::tests::ignores_lines_without_heading();
        crate::outline::tests::empty_document_has_no_outline();
        crate::paged_editor::tests::empty_editor_has_one_complete_a4_page();
        crate::paged_editor::tests::pages_can_be_inserted_ordered_and_removed();
        crate::paged_editor::tests::overflow_and_underflow_repaginate_without_losing_text();
        crate::paged_editor::tests::pages_share_tags_selection_cursor_and_undo_history();
        crate::paged_editor::tests::header_and_footer_repeat_and_page_numbers_update();
        crate::paged_editor::tests::one_long_paragraph_crosses_pages();
        crate::paged_editor::tests::editing_near_a_break_reflows_both_directions();
        crate::paged_editor::tests::repeated_large_document_layout_converges();
        crate::print::tests::page_breaks_split_when_content_overflows();
        crate::print::tests::export_produces_multi_page_pdf_with_pagination();
        crate::find_replace::tests::search_finds_all_occurrences_with_accented_text();
        crate::find_replace::tests::navigation_wraps_around_circularly();
        crate::find_replace::tests::replace_current_only_changes_the_current_match();
        crate::find_replace::tests::replace_all_handles_different_length_replacement_without_corruption();
        crate::find_replace::tests::clear_removes_highlights_and_resets_state();
        crate::wikilink::tests::typing_closing_brackets_converts_to_wikilink();
        crate::wikilink::tests::converts_multiple_pending_links_in_one_pass();
        crate::wikilink::tests::leaves_unclosed_brackets_untouched();
        crate::wikilink::tests::cursor_after_match_shifts_back_by_removed_brackets();
        crate::citation::tests::citation_tag_is_created_once_and_reused();
        crate::citation::tests::cite_key_from_tag_name_extracts_or_rejects();
        crate::citation::tests::apply_citation_round_trips_with_display_text_different_from_key();
        crate::font_style::tests::family_tag_is_created_once_and_reused();
        crate::font_style::tests::tag_name_extraction_round_trips();
        crate::font_style::tests::apply_font_style_combines_into_single_text_style_mark();
        crate::font_style::tests::active_family_and_size_are_none_without_any_tag();
        crate::font_style::tests::active_family_and_size_reflect_uniform_selection();
        crate::font_style::tests::active_family_and_size_are_none_when_selection_mixes_values();
        crate::font_style::tests::active_family_reflects_cursor_position_without_selection();
    }
}
