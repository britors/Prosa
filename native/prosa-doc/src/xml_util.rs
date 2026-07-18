//! Helpers de leitura de XML compartilhados entre `docx.rs` e `odt.rs`.
//!
//! Ambos os formatos usam prefixos de namespace (`w:`, `text:`, `style:`...)
//! que variam entre produtores (Word, LibreOffice, o nosso próprio writer),
//! então sempre comparamos pelo nome local, ignorando o prefixo.

use quick_xml::events::BytesStart;

pub(crate) fn local_name_string(name: quick_xml::name::QName) -> String {
    String::from_utf8_lossy(name.local_name().as_ref()).into_owned()
}

pub(crate) fn attr_by_local_name(e: &BytesStart, wanted: &str) -> Option<String> {
    e.attributes().flatten().find_map(|a| {
        let key_local = String::from_utf8_lossy(a.key.local_name().as_ref()).into_owned();
        if key_local == wanted {
            Some(String::from_utf8_lossy(&a.value).into_owned())
        } else {
            None
        }
    })
}
