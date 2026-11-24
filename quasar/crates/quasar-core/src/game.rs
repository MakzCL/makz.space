//! Game state the lighting can react to.
//!
//! Counter-Strike 2 ships Game State Integration: drop a cfg file into the
//! game's cfg folder and it POSTs JSON to a local URL on every change. The
//! shell runs the HTTP listener; this module parses the payload into a
//! neutral `GameState` that the "Game Pulse" effect understands. Other games
//! can map onto the same struct.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Bomb {
    #[default]
    None,
    Planted,
    Defused,
    Exploded,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct GameState {
    /// Which integration produced this, e.g. `cs2`. Empty when no game.
    pub source: String,
    pub active: bool,
    /// 0..1
    pub health: f32,
    pub armor: f32,
    pub ammo: f32,
    /// 0..1 flash blindness.
    pub flashed: f32,
    pub burning: bool,
    pub bomb: Bomb,
    pub team: String,
    pub round_phase: String,
    /// Seconds since last damage, for the hit flash. Advanced by the engine.
    pub since_hit: f32,
    /// Seconds since last kill.
    pub since_kill: f32,
}

impl GameState {
    /// Merge a CS2 GSI payload. Returns true when something changed.
    pub fn apply_cs2(&mut self, body: &Value) -> bool {
        let before = self.clone();
        self.source = "cs2".into();
        self.active = true;
        let ps = &body["player"]["state"];
        if let Some(h) = ps["health"].as_f64() {
            let h = (h as f32 / 100.0).clamp(0.0, 1.0);
            if h < self.health {
                self.since_hit = 0.0;
            }
            self.health = h;
        }
        if let Some(a) = ps["armor"].as_f64() {
            self.armor = (a as f32 / 100.0).clamp(0.0, 1.0);
        }
        if let Some(f) = ps["flashed"].as_f64() {
            self.flashed = (f as f32 / 255.0).clamp(0.0, 1.0);
        }
        if let Some(b) = ps["burning"].as_f64() {
            self.burning = b > 0.0;
        }
        if let (Some(k), Some(prev)) = (ps["round_kills"].as_i64(), before_kills(body)) {
            if k > prev {
                self.since_kill = 0.0;
            }
        }
        if let Some(t) = body["player"]["team"].as_str() {
            self.team = t.to_string();
        }
        if let Some(weapons) = body["player"]["weapons"].as_object() {
            for w in weapons.values() {
                if w["state"].as_str() == Some("active") {
                    if let (Some(c), Some(m)) = (w["ammo_clip"].as_f64(), w["ammo_clip_max"].as_f64()) {
                        if m > 0.0 {
                            self.ammo = (c / m) as f32;
                        }
                    }
                }
            }
        }
        if let Some(p) = body["round"]["phase"].as_str() {
            self.round_phase = p.to_string();
        }
        self.bomb = match body["round"]["bomb"].as_str() {
            Some("planted") => Bomb::Planted,
            Some("defused") => Bomb::Defused,
            Some("exploded") => Bomb::Exploded,
            _ => Bomb::None,
        };
        *self != before
    }

    pub fn advance(&mut self, dt: f32) {
        self.since_hit += dt;
        self.since_kill += dt;
    }
}

fn before_kills(body: &Value) -> Option<i64> {
    body["previously"]["player"]["state"]["round_kills"].as_i64()
}

/// The cfg file a user drops into `.../game/csgo/cfg/` to enable the feed.
pub fn cs2_cfg(port: u16) -> String {
    format!(
        r#""QUASAR Lighting"
{{
  "uri" "http://127.0.0.1:{port}/cs2"
  "timeout" "1.0"
  "buffer" "0.05"
  "throttle" "0.05"
  "heartbeat" "10.0"
  "data"
  {{
    "provider" "1"
    "round" "1"
    "player_id" "1"
    "player_state" "1"
    "player_weapons" "1"
  }}
}}
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cs2_payload() {
        let body: Value = serde_json::from_str(
            r#"{"player":{"team":"CT","state":{"health":40,"armor":100,"flashed":255,"burning":0,"round_kills":2},
                "weapons":{"weapon_1":{"state":"active","ammo_clip":15,"ammo_clip_max":30}}},
                "round":{"phase":"live","bomb":"planted"},
                "previously":{"player":{"state":{"round_kills":1}}}}"#,
        )
        .unwrap();
        let mut g = GameState { health: 1.0, since_hit: 9.0, since_kill: 9.0, ..Default::default() };
        assert!(g.apply_cs2(&body));
        assert_eq!(g.health, 0.4);
        assert_eq!(g.flashed, 1.0);
        assert_eq!(g.ammo, 0.5);
        assert_eq!(g.bomb, Bomb::Planted);
        assert_eq!(g.since_hit, 0.0);
        assert_eq!(g.since_kill, 0.0);
        assert_eq!(g.team, "CT");
    }

    #[test]
    fn cfg_points_at_port() {
        assert!(cs2_cfg(4242).contains("http://127.0.0.1:4242/cs2"));
    }
}
