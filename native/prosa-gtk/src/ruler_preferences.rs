use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RulerPreferences {
    pub visible: bool,
    pub unit: &'static str,
}

impl Default for RulerPreferences {
    fn default() -> Self { Self { visible: true, unit: "cm" } }
}

fn path() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .map(|root| root.join("prosa/preferences.json"))
}

fn load_from(path: &Path) -> RulerPreferences {
    let Ok(raw) = std::fs::read_to_string(path) else { return RulerPreferences::default() };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else { return RulerPreferences::default() };
    let visible = value.get("showRulers").and_then(|value| value.as_bool()).unwrap_or(true);
    let unit = match value.get("rulerUnit").and_then(|value| value.as_str()) {
        Some("mm") => "mm", Some("in") => "in", Some("pt") => "pt", _ => "cm",
    };
    RulerPreferences { visible, unit }
}

fn save_to(path: &Path, preferences: RulerPreferences) {
    let Some(parent) = path.parent() else { return };
    if std::fs::create_dir_all(parent).is_err() { return; }
    let value = serde_json::json!({ "showRulers": preferences.visible, "rulerUnit": preferences.unit });
    if let Ok(raw) = serde_json::to_string_pretty(&value) { let _ = std::fs::write(path, raw); }
}

pub fn load() -> RulerPreferences { path().map_or_else(RulerPreferences::default, |path| load_from(&path)) }
pub fn save(preferences: RulerPreferences) { if let Some(path) = path() { save_to(&path, preferences); } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferences_round_trip_and_invalid_values_fall_back() {
        let dir = std::env::temp_dir().join(format!("prosa-ruler-prefs-{}", std::process::id()));
        let file = dir.join("preferences.json");
        save_to(&file, RulerPreferences { visible: false, unit: "in" });
        assert_eq!(load_from(&file), RulerPreferences { visible: false, unit: "in" });
        std::fs::write(&file, r#"{"showRulers":true,"rulerUnit":"unknown"}"#).unwrap();
        assert_eq!(load_from(&file), RulerPreferences::default());
        std::fs::remove_dir_all(dir).ok();
    }
}
