//! Effect parameters: a schema the UI renders as controls, and the values.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::color::Rgb;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ParamKind {
    Number { min: f32, max: f32, step: f32, unit: Option<String> },
    Color,
    Bool,
    Choice { options: Vec<(String, String)> },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ParamSpec {
    pub key: String,
    pub label: String,
    #[serde(flatten)]
    pub kind: ParamKind,
    pub default: ParamValue,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ParamValue {
    Bool(bool),
    Number(f32),
    /// Colours travel as `#rrggbb`; choices as their key.
    Text(String),
}

pub type Params = BTreeMap<String, ParamValue>;

pub fn number(key: &str, label: &str, min: f32, max: f32, step: f32, default: f32) -> ParamSpec {
    ParamSpec {
        key: key.into(),
        label: label.into(),
        kind: ParamKind::Number { min, max, step, unit: None },
        default: ParamValue::Number(default),
    }
}

pub fn color(key: &str, label: &str, default: &str) -> ParamSpec {
    ParamSpec { key: key.into(), label: label.into(), kind: ParamKind::Color, default: ParamValue::Text(default.into()) }
}

pub fn toggle(key: &str, label: &str, default: bool) -> ParamSpec {
    ParamSpec { key: key.into(), label: label.into(), kind: ParamKind::Bool, default: ParamValue::Bool(default) }
}

pub fn choice(key: &str, label: &str, options: &[(&str, &str)], default: &str) -> ParamSpec {
    ParamSpec {
        key: key.into(),
        label: label.into(),
        kind: ParamKind::Choice { options: options.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect() },
        default: ParamValue::Text(default.into()),
    }
}

/// Read access to parameter values with fallbacks, so an effect never has to
/// care whether the UI sent every key.
pub struct P<'a>(pub &'a Params);

impl P<'_> {
    pub fn num(&self, k: &str, d: f32) -> f32 {
        match self.0.get(k) {
            Some(ParamValue::Number(n)) => *n,
            Some(ParamValue::Text(s)) => s.parse().unwrap_or(d),
            _ => d,
        }
    }
    pub fn flag(&self, k: &str, d: bool) -> bool {
        match self.0.get(k) {
            Some(ParamValue::Bool(b)) => *b,
            _ => d,
        }
    }
    pub fn col(&self, k: &str, d: &str) -> [f32; 3] {
        let s = match self.0.get(k) {
            Some(ParamValue::Text(s)) => s.as_str(),
            _ => d,
        };
        Rgb::from_hex(s).or_else(|| Rgb::from_hex(d)).unwrap_or_default().to_f()
    }
    pub fn pick<'b>(&'b self, k: &str, d: &'b str) -> &'b str {
        match self.0.get(k) {
            Some(ParamValue::Text(s)) => s.as_str(),
            _ => d,
        }
    }
}

pub fn defaults(specs: &[ParamSpec]) -> Params {
    specs.iter().map(|s| (s.key.clone(), s.default.clone())).collect()
}
