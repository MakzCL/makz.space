//! Macros: recorded or authored sequences of input.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Step {
    KeyDown { key: String },
    KeyUp { key: String },
    MouseDown { button: String },
    MouseUp { button: String },
    Delay { ms: u32 },
    Text { text: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "kebab-case")]
pub enum Repeat {
    Once,
    Times { n: u32 },
    WhileHeld,
    Toggle,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Macro {
    pub id: String,
    pub name: String,
    pub steps: Vec<Step>,
    pub repeat: Repeat,
    /// A system-wide shortcut that runs this macro.
    #[serde(default)]
    pub hotkey: Option<Hotkey>,
}

/// A key (or mouse button) plus the modifiers that must be held with it.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Hotkey {
    pub key: String,
    #[serde(default)]
    pub modifiers: Vec<String>,
}

impl Hotkey {
    /// Normalised modifier set: Ctrl, Shift, Alt, Win (left/right merged).
    pub fn canonical(m: &str) -> Option<&'static str> {
        match m {
            "Ctrl" | "LCtrl" | "RCtrl" | "Control" => Some("Ctrl"),
            "Shift" | "LShift" | "RShift" => Some("Shift"),
            "Alt" | "LAlt" | "RAlt" | "AltGr" => Some("Alt"),
            "Win" | "Meta" | "Menu" => Some("Win"),
            _ => None,
        }
    }

    /// Does pressing `key` with exactly `held` modifiers trigger this?
    pub fn matches(&self, key: &str, held: &[&str]) -> bool {
        if !self.key.eq_ignore_ascii_case(key) {
            return false;
        }
        let mut want: Vec<&str> = self.modifiers.iter().filter_map(|m| Hotkey::canonical(m)).collect();
        let mut have: Vec<&str> = held.iter().filter_map(|m| Hotkey::canonical(m)).collect();
        want.sort_unstable();
        want.dedup();
        have.sort_unstable();
        have.dedup();
        want == have
    }
}

impl Macro {
    pub fn duration_ms(&self) -> u32 {
        self.steps.iter().map(|s| if let Step::Delay { ms } = s { *ms } else { 0 }).sum()
    }

    /// Collapse a raw recording: merge consecutive delays and drop delays
    /// shorter than `min_ms` (recording jitter) when `tidy`.
    pub fn tidy(steps: Vec<Step>, min_ms: u32) -> Vec<Step> {
        let mut out: Vec<Step> = Vec::with_capacity(steps.len());
        for s in steps {
            match (out.last_mut(), &s) {
                (Some(Step::Delay { ms: a }), Step::Delay { ms: b }) => *a += b,
                _ => out.push(s),
            }
        }
        out.retain(|s| !matches!(s, Step::Delay { ms } if *ms < min_ms));
        out
    }
}

pub fn examples() -> Vec<Macro> {
    let key = |k: &str| [Step::KeyDown { key: k.into() }, Step::KeyUp { key: k.into() }];
    vec![
        Macro {
            id: "m-gg".into(),
            name: "GG in chat".into(),
            steps: [key("Enter").to_vec(), vec![Step::Delay { ms: 40 }, Step::Text { text: "gg wp".into() }], key("Enter").to_vec()].concat(),
            repeat: Repeat::Once,
            hotkey: None,
        },
        Macro {
            id: "m-burst".into(),
            name: "Triple tap".into(),
            steps: (0..3)
                .flat_map(|_| [Step::MouseDown { button: "Left".into() }, Step::Delay { ms: 30 }, Step::MouseUp { button: "Left".into() }, Step::Delay { ms: 60 }])
                .collect(),
            repeat: Repeat::Once,
            hotkey: None,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tidy_merges_and_drops() {
        let steps = vec![
            Step::KeyDown { key: "A".into() },
            Step::Delay { ms: 3 },
            Step::Delay { ms: 4 },
            Step::KeyUp { key: "A".into() },
            Step::Delay { ms: 2 },
        ];
        let t = Macro::tidy(steps, 5);
        assert_eq!(t, vec![Step::KeyDown { key: "A".into() }, Step::Delay { ms: 7 }, Step::KeyUp { key: "A".into() }]);
    }

    #[test]
    fn hotkeys_match_exact_modifiers() {
        let h = Hotkey { key: "F1".into(), modifiers: vec!["Ctrl".into(), "Alt".into()] };
        assert!(h.matches("F1", &["LCtrl", "RAlt"]));
        assert!(h.matches("f1", &["LAlt", "LCtrl"]));
        assert!(!h.matches("F1", &["LCtrl"]), "missing Alt");
        assert!(!h.matches("F1", &["LCtrl", "LAlt", "LShift"]), "extra Shift");
        assert!(!h.matches("F2", &["LCtrl", "LAlt"]));
        let side = Hotkey { key: "Back".into(), modifiers: vec![] };
        assert!(side.matches("Back", &[]));
        // older saved macros have no hotkey field
        let m: Macro = serde_json::from_str(r#"{"id":"a","name":"x","steps":[],"repeat":{"mode":"once"}}"#).unwrap();
        assert!(m.hotkey.is_none());
    }

    #[test]
    fn examples_have_duration() {
        assert_eq!(examples()[1].duration_ms(), 270);
    }
}
