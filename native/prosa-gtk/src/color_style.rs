//! Cor de texto e realce como tags dinâmicas persistentes.

use gtk::prelude::*;

pub const FOREGROUND_PREFIX: &str = "prosa-color:";
pub const BACKGROUND_PREFIX: &str = "prosa-highlight:";

pub fn color_from_tag_name(name: &str) -> Option<&str> {
    name.strip_prefix(FOREGROUND_PREFIX)
}

pub fn highlight_from_tag_name(name: &str) -> Option<&str> {
    name.strip_prefix(BACKGROUND_PREFIX)
}

fn rgba_hex(color: &gtk::gdk::RGBA) -> String {
    format!(
        "#{:02X}{:02X}{:02X}",
        (color.red() * 255.0).round() as u8,
        (color.green() * 255.0).round() as u8,
        (color.blue() * 255.0).round() as u8,
    )
}

fn style_tag(buffer: &gtk::TextBuffer, prefix: &str, color: &str) -> gtk::TextTag {
    let name = format!("{prefix}{color}");
    if let Some(tag) = buffer.tag_table().lookup(&name) {
        return tag;
    }
    let rgba = gtk::gdk::RGBA::parse(color).unwrap_or_else(|_| gtk::gdk::RGBA::BLACK);
    let tag = if prefix == FOREGROUND_PREFIX {
        gtk::TextTag::builder().name(&name).foreground_rgba(&rgba).build()
    } else {
        gtk::TextTag::builder().name(&name).background_rgba(&rgba).build()
    };
    buffer.tag_table().add(&tag);
    tag
}

pub fn color_tag(buffer: &gtk::TextBuffer, color: &str) -> gtk::TextTag {
    style_tag(buffer, FOREGROUND_PREFIX, color)
}

pub fn highlight_tag(buffer: &gtk::TextBuffer, color: &str) -> gtk::TextTag {
    style_tag(buffer, BACKGROUND_PREFIX, color)
}

pub fn apply_color(buffer: &gtk::TextBuffer, color: &gtk::gdk::RGBA, highlight: bool) {
    let Some((start, end)) = buffer.selection_bounds() else { return };
    let prefix = if highlight { BACKGROUND_PREFIX } else { FOREGROUND_PREFIX };
    let mut tags = Vec::new();
    let mut iter = start.clone();
    while iter < end {
        for tag in iter.tags() {
            if tag.name().is_some_and(|name| name.starts_with(prefix)) && !tags.contains(&tag) {
                tags.push(tag);
            }
        }
        if !iter.forward_char() {
            break;
        }
    }
    for tag in tags {
        buffer.remove_tag(&tag, &start, &end);
    }
    let color = rgba_hex(color);
    let tag = if highlight { highlight_tag(buffer, &color) } else { color_tag(buffer, &color) };
    buffer.apply_tag(&tag, &start, &end);
}
