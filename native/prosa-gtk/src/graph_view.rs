//! Visualização em grafo das conexões (wikilinks) de um workspace.
//!
//! A versão Electron nunca implementou isso de fato — `graph-view.ts` era um
//! placeholder estático ("Grafo de conexões em desenvolvimento..."), sem
//! nenhuma lógica de layout/desenho a portar. Esta é uma implementação nova,
//! desenhada com `GtkDrawingArea` + Cairo direto (sem depender de nenhuma
//! biblioteca de grafo, que o projeto não tem).
//!
//! O layout é um círculo simples (nós distribuídos em ângulos iguais), não
//! um force-directed de verdade — para o tamanho de workspace que esse app
//! atende (dezenas de documentos, não milhares), um círculo já deixa as
//! conexões legíveis sem a complexidade de uma simulação física.

use std::path::PathBuf;
use std::rc::Rc;

use gtk::prelude::*;

use prosa_doc::workspace::{build_graph, scan_workspace, DocumentSummary, GraphEdge};

const NODE_RADIUS: f64 = 10.0;
/// Raia do layout circular, como fração do menor lado do canvas.
const LAYOUT_RADIUS_FRACTION: f64 = 0.38;

/// Posição normalizada (0..1 em cada eixo) de um nó no canvas.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NodePosition {
    pub x: f64,
    pub y: f64,
}

/// Distribui `count` nós em círculo, começando no topo e andando no sentido
/// horário. Casos degenerados (0 ou 1 nó) ficam centralizados, sem dividir
/// por zero.
pub fn circular_layout(count: usize) -> Vec<NodePosition> {
    if count == 0 {
        return Vec::new();
    }
    if count == 1 {
        return vec![NodePosition { x: 0.5, y: 0.5 }];
    }
    (0..count)
        .map(|index| {
            let angle = 2.0 * std::f64::consts::PI * (index as f64) / (count as f64) - std::f64::consts::FRAC_PI_2;
            NodePosition { x: 0.5 + LAYOUT_RADIUS_FRACTION * angle.cos(), y: 0.5 + LAYOUT_RADIUS_FRACTION * angle.sin() }
        })
        .collect()
}

/// Índice do nó mais próximo de `(click_x, click_y)` (coordenadas de
/// widget, em pixels), se algum estiver dentro do raio de clique. `width`/
/// `height` são as dimensões do canvas usadas pra desnormalizar `positions`.
pub fn nearest_node(positions: &[NodePosition], width: f64, height: f64, click_x: f64, click_y: f64) -> Option<usize> {
    let click_radius = NODE_RADIUS * 2.0;
    positions
        .iter()
        .enumerate()
        .map(|(index, pos)| {
            let dx = pos.x * width - click_x;
            let dy = pos.y * height - click_y;
            (index, (dx * dx + dy * dy).sqrt())
        })
        .filter(|(_, distance)| *distance <= click_radius)
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(index, _)| index)
}

fn draw_graph(cr: &cairo::Context, width: i32, height: i32, positions: &[NodePosition], nodes: &[DocumentSummary], edges: &[GraphEdge]) {
    let (w, h) = (width as f64, height as f64);

    cr.set_source_rgb(0.18, 0.18, 0.18);
    let _ = cr.paint();

    cr.set_source_rgba(0.7, 0.7, 0.7, 0.5);
    cr.set_line_width(1.2);
    for edge in edges {
        let (Some(from), Some(to)) = (positions.get(edge.from), positions.get(edge.to)) else { continue };
        cr.move_to(from.x * w, from.y * h);
        cr.line_to(to.x * w, to.y * h);
        let _ = cr.stroke();
    }

    for (index, pos) in positions.iter().enumerate() {
        let (x, y) = (pos.x * w, pos.y * h);

        cr.set_source_rgb(0.53, 0.42, 0.93);
        cr.arc(x, y, NODE_RADIUS, 0.0, std::f64::consts::TAU);
        let _ = cr.fill();

        let Some(title) = nodes.get(index).map(|node| node.title.as_str()) else { continue };
        cr.set_source_rgb(0.92, 0.92, 0.92);
        cr.set_font_size(12.0);
        let text_width = cr.text_extents(title).map(|extents| extents.width()).unwrap_or(0.0);
        cr.move_to(x - text_width / 2.0, y + NODE_RADIUS + 14.0);
        let _ = cr.show_text(title);
    }
}

/// Abre a janela do grafo de conexões do workspace em `root`. `on_open` é
/// chamado com o caminho do documento quando o usuário clica num nó.
pub fn open_graph_window(parent: &adw::ApplicationWindow, root: PathBuf, on_open: impl Fn(PathBuf) + 'static) {
    let docs = scan_workspace(&root);
    let graph = build_graph(&root, &docs);
    let positions = Rc::new(circular_layout(graph.nodes.len()));
    let nodes = Rc::new(graph.nodes);
    let edges = Rc::new(graph.edges);

    let toolbar_view = adw::ToolbarView::new();
    toolbar_view.add_top_bar(&adw::HeaderBar::new());

    if nodes.is_empty() {
        let status = adw::StatusPage::builder()
            .icon_name("network-workgroup-symbolic")
            .title("Nenhum documento encontrado")
            .description("A pasta de workspace escolhida não tem nenhum arquivo .prosa ainda.")
            .build();
        toolbar_view.set_content(Some(&status));
    } else {
        let drawing_area = gtk::DrawingArea::builder().content_width(700).content_height(700).hexpand(true).vexpand(true).build();
        drawing_area.set_draw_func(glib::clone!(
            #[strong]
            positions,
            #[strong]
            nodes,
            #[strong]
            edges,
            move |_area, cr, width, height| draw_graph(cr, width, height, &positions, &nodes, &edges)
        ));

        let click = gtk::GestureClick::new();
        click.connect_released(glib::clone!(
            #[strong]
            positions,
            #[strong]
            nodes,
            #[weak]
            drawing_area,
            move |_, _, x, y| {
                let width = drawing_area.width() as f64;
                let height = drawing_area.height() as f64;
                if let Some(index) = nearest_node(&positions, width, height, x, y) {
                    if let Some(node) = nodes.get(index) {
                        on_open(node.path.clone());
                    }
                }
            }
        ));
        drawing_area.add_controller(click);

        let scrolled = gtk::ScrolledWindow::builder().child(&drawing_area).build();
        toolbar_view.set_content(Some(&scrolled));
    }

    let window = adw::Window::builder()
        .transient_for(parent)
        .title("Grafo de conexões")
        .default_width(760)
        .default_height(760)
        .content(&toolbar_view)
        .build();
    window.present();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn circular_layout_empty_has_no_nodes() {
        assert!(circular_layout(0).is_empty());
    }

    #[test]
    fn circular_layout_single_node_is_centered() {
        assert_eq!(circular_layout(1), vec![NodePosition { x: 0.5, y: 0.5 }]);
    }

    #[test]
    fn circular_layout_spreads_nodes_evenly_around_center() {
        let positions = circular_layout(4);
        assert_eq!(positions.len(), 4);
        for pos in &positions {
            let dx = pos.x - 0.5;
            let dy = pos.y - 0.5;
            let distance = (dx * dx + dy * dy).sqrt();
            assert!((distance - LAYOUT_RADIUS_FRACTION).abs() < 1e-9, "nó deve ficar exatamente no raio do layout");
        }
        // Primeiro nó começa no topo (ângulo -90°).
        assert!((positions[0].x - 0.5).abs() < 1e-9);
        assert!(positions[0].y < 0.5);
    }

    #[test]
    fn nearest_node_finds_closest_within_click_radius() {
        let positions = vec![NodePosition { x: 0.25, y: 0.5 }, NodePosition { x: 0.75, y: 0.5 }];
        let index = nearest_node(&positions, 400.0, 400.0, 100.0, 200.0);
        assert_eq!(index, Some(0), "clique perto de x=100 (nó 0 está em x=100) deve achar o nó 0");
    }

    #[test]
    fn nearest_node_returns_none_when_click_is_far_from_every_node() {
        let positions = vec![NodePosition { x: 0.5, y: 0.5 }];
        let index = nearest_node(&positions, 400.0, 400.0, 10.0, 10.0);
        assert_eq!(index, None);
    }
}
