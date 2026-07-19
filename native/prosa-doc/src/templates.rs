//! Catálogo de templates de documento.
//!
//! Espelha `src/shared/document-templates.ts`: um catálogo estático (não há
//! templates criados pelo usuário neste sistema — isso não deve ser
//! confundido com `src/main/templates.ts` do Electron, que é sobre folhas
//! de estilo CSS persistidas em disco, um sistema completamente separado e
//! sem relação com esta issue).
//!
//! O original guarda o conteúdo como HTML cru, interpretado pelo parser de
//! HTML do TipTap (`editor.commands.setContent`). O app nativo não tem (nem
//! precisa ter, só por causa de 6 templates fixos e rasos) um parser de
//! HTML genérico — o conteúdo de cada template é montado direto como
//! `TipTapNode`, estruturalmente idêntico ao que o HTML original produziria.

use crate::{Mark, TipTapNode};

/// Categoria de um template, só para agrupar na UI de escolha.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TemplateCategory {
    Academico,
    Corporativo,
    Juridico,
    Operacional,
    Editorial,
}

impl TemplateCategory {
    pub fn label(self) -> &'static str {
        match self {
            TemplateCategory::Academico => "Acadêmico",
            TemplateCategory::Corporativo => "Corporativo",
            TemplateCategory::Juridico => "Jurídico",
            TemplateCategory::Operacional => "Operacional",
            TemplateCategory::Editorial => "Editorial",
        }
    }
}

/// Um template de documento pronto pra uso.
#[derive(Clone)]
pub struct DocumentTemplate {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub category: TemplateCategory,
    /// Extensão do formato preferido pra salvar este tipo de documento
    /// (`"docx"`/`"odt"`) — o original nunca sugere `.prosa` como preferido
    /// para nenhum template, mesmo sendo o formato nativo; mantido assim.
    pub preferred_format: &'static str,
    pub document_name: &'static str,
    pub content: TipTapNode,
}

fn text(value: &str) -> TipTapNode {
    TipTapNode { kind: "text".to_string(), text: Some(value.to_string()), ..Default::default() }
}

fn text_marked(value: &str, mark_kind: &str) -> TipTapNode {
    TipTapNode { kind: "text".to_string(), text: Some(value.to_string()), marks: Some(vec![Mark { kind: mark_kind.to_string(), attrs: None }]), ..Default::default() }
}

fn heading(level: u8, value: &str) -> TipTapNode {
    TipTapNode { kind: "heading".to_string(), attrs: Some(serde_json::json!({ "level": level })), content: Some(vec![text(value)]), ..Default::default() }
}

fn paragraph(children: Vec<TipTapNode>) -> TipTapNode {
    TipTapNode { kind: "paragraph".to_string(), content: Some(children), ..Default::default() }
}

fn paragraph_text(value: &str) -> TipTapNode {
    paragraph(vec![text(value)])
}

fn paragraph_italic(value: &str) -> TipTapNode {
    paragraph(vec![text_marked(value, "italic")])
}

/// Parágrafo "**Rótulo:** resto", como `<p><strong>Rótulo:</strong> resto</p>`.
fn paragraph_label(label: &str, rest: &str) -> TipTapNode {
    paragraph(vec![text_marked(&format!("{label}:"), "bold"), text(rest)])
}

fn empty_paragraph() -> TipTapNode {
    TipTapNode { kind: "paragraph".to_string(), ..Default::default() }
}

fn doc(blocks: Vec<TipTapNode>) -> TipTapNode {
    TipTapNode { kind: "doc".to_string(), content: Some(blocks), ..Default::default() }
}

/// Seções de nível 2 vazias ("Título" seguido de um parágrafo em branco),
/// repetido em quase todos os templates.
fn empty_sections(titles: &[&str]) -> Vec<TipTapNode> {
    titles.iter().flat_map(|title| [heading(2, title), empty_paragraph()]).collect()
}

/// Catálogo completo, na mesma ordem do original.
pub fn document_templates() -> Vec<DocumentTemplate> {
    vec![
        DocumentTemplate {
            id: "artigo",
            name: "Artigo",
            description: "Estrutura para artigo curto com resumo, seções e referências.",
            category: TemplateCategory::Academico,
            preferred_format: "docx",
            document_name: "Artigo.prosa",
            content: doc({
                let mut blocks = vec![heading(1, "Título do artigo"), paragraph_italic("Subtítulo opcional")];
                blocks.extend(empty_sections(&["Resumo", "Palavras-chave", "Introdução", "Desenvolvimento", "Conclusão", "Referências"]));
                blocks
            }),
        },
        DocumentTemplate {
            id: "relatorio",
            name: "Relatório",
            description: "Modelo para relatórios com objetivo, análise e encaminhamentos.",
            category: TemplateCategory::Corporativo,
            preferred_format: "docx",
            document_name: "Relatório.prosa",
            content: doc({
                let mut blocks = vec![
                    heading(1, "Relatório"),
                    paragraph_label("Responsável", " Nome do autor"),
                    paragraph_label("Período", " Data de início a data de fim"),
                ];
                blocks.extend(empty_sections(&["Resumo executivo", "Contexto", "Resultados", "Próximos passos"]));
                blocks
            }),
        },
        DocumentTemplate {
            id: "contrato",
            name: "Contrato",
            description: "Estrutura básica de contrato com cláusulas numeradas.",
            category: TemplateCategory::Juridico,
            preferred_format: "odt",
            document_name: "Contrato.prosa",
            content: doc({
                let mut blocks = vec![heading(1, "Contrato de prestação de serviços"), paragraph_text("Entre as partes qualificadas abaixo.")];
                blocks.extend(empty_sections(&[
                    "Cláusula 1 - Objeto",
                    "Cláusula 2 - Prazo",
                    "Cláusula 3 - Condições de pagamento",
                    "Cláusula 4 - Rescisão",
                    "Cláusula 5 - Foro",
                ]));
                blocks
            }),
        },
        DocumentTemplate {
            id: "ata",
            name: "Ata",
            description: "Ata de reunião com pauta, participantes e deliberações.",
            category: TemplateCategory::Operacional,
            preferred_format: "odt",
            document_name: "Ata.prosa",
            content: doc({
                let mut blocks = vec![heading(1, "Ata de reunião"), paragraph_label("Data", " "), paragraph_label("Local", " ")];
                blocks.extend(empty_sections(&["Participantes", "Pauta", "Deliberações", "Encerramento"]));
                blocks
            }),
        },
        DocumentTemplate {
            id: "proposta-comercial",
            name: "Proposta comercial",
            description: "Proposta com escopo, entregas, cronograma e investimento.",
            category: TemplateCategory::Corporativo,
            preferred_format: "docx",
            document_name: "Proposta-comercial.prosa",
            content: doc({
                let mut blocks = vec![heading(1, "Proposta comercial"), paragraph_label("Cliente", " "), paragraph_label("Data", " ")];
                blocks.extend(empty_sections(&["Resumo executivo", "Escopo", "Entregas", "Cronograma", "Investimento"]));
                blocks
            }),
        },
        DocumentTemplate {
            id: "capitulo",
            name: "Capítulo de livro",
            description: "Estrutura para capítulo com introdução, desenvolvimento e fechamento.",
            category: TemplateCategory::Editorial,
            preferred_format: "docx",
            document_name: "Capitulo-de-livro.prosa",
            content: doc({
                let mut blocks = vec![heading(1, "Capítulo 1 - Título do capítulo"), paragraph_text("Texto de abertura do capítulo.")];
                blocks.extend(empty_sections(&["Introdução", "Desenvolvimento", "Conclusão", "Notas finais"]));
                blocks
            }),
        },
    ]
}

/// Busca um template pelo `id`.
pub fn get_document_template(id: &str) -> Option<DocumentTemplate> {
    document_templates().into_iter().find(|template| template.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPECTED_IDS: [&str; 6] = ["artigo", "relatorio", "contrato", "ata", "proposta-comercial", "capitulo"];

    #[test]
    fn all_expected_ids_exist() {
        let templates = document_templates();
        for id in EXPECTED_IDS {
            assert!(templates.iter().any(|t| t.id == id), "template '{id}' deveria existir no catálogo");
        }
        assert_eq!(templates.len(), EXPECTED_IDS.len(), "catálogo não deveria ter templates a mais nem a menos que o original");
    }

    #[test]
    fn get_document_template_finds_by_id_and_none_for_unknown() {
        assert!(get_document_template("artigo").is_some());
        assert!(get_document_template("inexistente").is_none());
    }

    #[test]
    fn artigo_template_has_expected_sections_in_order() {
        let template = get_document_template("artigo").unwrap();
        assert_eq!(template.category.label(), "Acadêmico");
        assert_eq!(template.preferred_format, "docx");
        let text = template.content.plain_text();
        assert!(text.starts_with("Título do artigo\nSubtítulo opcional\nResumo"));
        assert!(text.ends_with("Referências\n"), "última seção fica vazia, então a linha final é só o título");
    }

    #[test]
    fn relatorio_template_keeps_bold_labels() {
        let template = get_document_template("relatorio").unwrap();
        let first_paragraph = &template.content.content.as_ref().unwrap()[1];
        let first_run = &first_paragraph.content.as_ref().unwrap()[0];
        assert_eq!(first_run.text.as_deref(), Some("Responsável:"));
        assert_eq!(first_run.marks.as_ref().unwrap()[0].kind, "bold");
    }

    #[test]
    fn every_template_content_is_a_valid_doc_node() {
        for template in document_templates() {
            assert_eq!(template.content.kind, "doc");
            assert!(template.content.content.is_some_and(|blocks| !blocks.is_empty()));
        }
    }
}
