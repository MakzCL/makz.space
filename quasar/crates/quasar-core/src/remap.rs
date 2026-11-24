//! Remapping: decide what a physical input should become, given the active
//! bindings. Pure logic; the shell's input hook calls `resolve` and performs
//! the resulting actions.

use std::collections::BTreeMap;

use crate::device::Binding;

#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    /// Let the original event through.
    Pass,
    /// Swallow it.
    Block,
    /// Swallow it and do this instead.
    Do(Binding),
}

#[derive(Default)]
pub struct Remapper {
    pub primary: BTreeMap<String, Binding>,
    pub overdrive: BTreeMap<String, Binding>,
    overdrive_held: bool,
}

impl Remapper {
    pub fn new(primary: BTreeMap<String, Binding>, overdrive: BTreeMap<String, Binding>) -> Self {
        Self { primary, overdrive, overdrive_held: false }
    }

    pub fn resolve(&mut self, key: &str, down: bool) -> Action {
        let b = if self.overdrive_held { self.overdrive.get(key).or_else(|| self.primary.get(key)) } else { self.primary.get(key) };
        match b {
            None | Some(Binding::Default) => Action::Pass,
            Some(Binding::Disabled) => Action::Block,
            Some(Binding::Overdrive) => {
                self.overdrive_held = down;
                Action::Block
            }
            Some(other) => Action::Do(other.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overdrive_layer() {
        let mut p = BTreeMap::new();
        p.insert("CapsLock".into(), Binding::Overdrive);
        p.insert("F13".into(), Binding::Disabled);
        let mut o = BTreeMap::new();
        o.insert("W".into(), Binding::Media { action: "volume-up".into() });
        let mut r = Remapper::new(p, o);
        assert_eq!(r.resolve("W", true), Action::Pass);
        assert_eq!(r.resolve("F13", true), Action::Block);
        assert_eq!(r.resolve("CapsLock", true), Action::Block);
        assert_eq!(r.resolve("W", true), Action::Do(Binding::Media { action: "volume-up".into() }));
        r.resolve("CapsLock", false);
        assert_eq!(r.resolve("W", true), Action::Pass);
    }
}
