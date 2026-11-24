//! OpenRGB SDK client.
//!
//! OpenRGB (openrgb.org) already speaks to hundreds of RGB controllers from
//! most brands: motherboards, RAM, GPUs, coolers, keyboards, mice, strips.
//! Its SDK server exposes all of them over a small binary TCP protocol, which
//! this module implements, so QUASAR can drive the whole list per LED.
//!
//! Wire format: every packet starts with `ORGB`, then little-endian
//! `u32 device_index`, `u32 packet_id`, `u32 payload_size`. We negotiate
//! protocol version 3 at most, which keeps the controller-data layout fixed
//! (version 4 added zone segments).

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use super::Backend;
use crate::color::Rgb;
use crate::device::{Capabilities, DeviceInfo, DeviceKind, DeviceSettings, DeviceStatus};
use crate::layout::{Layout, Led};
use crate::{Error, Result};

pub const DEFAULT_PORT: u16 = 6742;
pub const MAX_PROTOCOL: u32 = 3;

pub mod pkt {
    pub const REQUEST_CONTROLLER_COUNT: u32 = 0;
    pub const REQUEST_CONTROLLER_DATA: u32 = 1;
    pub const REQUEST_PROTOCOL_VERSION: u32 = 40;
    pub const SET_CLIENT_NAME: u32 = 50;
    pub const DEVICE_LIST_UPDATED: u32 = 100;
    pub const UPDATE_LEDS: u32 = 1050;
    pub const SET_CUSTOM_MODE: u32 = 1100;
}

pub fn header(dev: u32, id: u32, len: u32) -> [u8; 16] {
    let mut h = [0u8; 16];
    h[..4].copy_from_slice(b"ORGB");
    h[4..8].copy_from_slice(&dev.to_le_bytes());
    h[8..12].copy_from_slice(&id.to_le_bytes());
    h[12..16].copy_from_slice(&len.to_le_bytes());
    h
}

/// `UPDATE_LEDS` payload: `u32 size, u16 count, count * (r, g, b, 0)`.
pub fn update_leds_payload(colors: &[Rgb]) -> Vec<u8> {
    let size = 4 + 2 + colors.len() * 4;
    let mut v = Vec::with_capacity(size);
    v.extend_from_slice(&(size as u32).to_le_bytes());
    v.extend_from_slice(&(colors.len() as u16).to_le_bytes());
    for c in colors {
        v.extend_from_slice(&[c.r, c.g, c.b, 0]);
    }
    v
}

#[derive(Clone, Debug, PartialEq)]
pub struct Zone {
    pub name: String,
    pub kind: i32,
    pub leds_count: u32,
    /// Row-major matrix of LED indices into the zone (`u32::MAX` = no LED).
    pub matrix: Option<(u32, u32, Vec<u32>)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Controller {
    pub kind: i32,
    pub name: String,
    pub vendor: String,
    pub description: String,
    pub version: String,
    pub serial: String,
    pub location: String,
    pub modes: Vec<String>,
    pub zones: Vec<Zone>,
    pub leds: Vec<String>,
}

struct Cursor<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if self.i + n > self.b.len() {
            return Err(Error::Protocol(format!("controller data truncated at byte {}", self.i)));
        }
        let s = &self.b[self.i..self.i + n];
        self.i += n;
        Ok(s)
    }
    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i32(&mut self) -> Result<i32> {
        Ok(self.u32()? as i32)
    }
    /// Length-prefixed, NUL-terminated string.
    fn str(&mut self) -> Result<String> {
        let n = self.u16()? as usize;
        let s = self.take(n)?;
        let s = s.strip_suffix(&[0]).unwrap_or(s);
        Ok(String::from_utf8_lossy(s).into_owned())
    }
}

/// Parse a `REQUEST_CONTROLLER_DATA` reply for protocol `proto` (0..=3).
pub fn parse_controller(b: &[u8], proto: u32) -> Result<Controller> {
    let mut c = Cursor { b, i: 0 };
    let _size = c.u32()?;
    let kind = c.i32()?;
    let name = c.str()?;
    let vendor = if proto >= 1 { c.str()? } else { String::new() };
    let description = c.str()?;
    let version = c.str()?;
    let serial = c.str()?;
    let location = c.str()?;
    let num_modes = c.u16()?;
    let _active = c.i32()?;
    let mut modes = Vec::new();
    for _ in 0..num_modes {
        modes.push(c.str()?);
        c.take(4 * 4)?; // value, flags, speed_min, speed_max
        if proto >= 3 {
            c.take(4 * 2)?; // brightness min/max
        }
        c.take(4 * 3)?; // colors_min, colors_max, speed
        if proto >= 3 {
            c.take(4)?; // brightness
        }
        c.take(4 * 2)?; // direction, color_mode
        let n = c.u16()? as usize;
        c.take(n * 4)?;
    }
    let num_zones = c.u16()?;
    let mut zones = Vec::new();
    for _ in 0..num_zones {
        let zname = c.str()?;
        let zkind = c.i32()?;
        let _min = c.u32()?;
        let _max = c.u32()?;
        let count = c.u32()?;
        let mlen = c.u16()?;
        let matrix = if mlen > 0 {
            let h = c.u32()?;
            let w = c.u32()?;
            let mut m = Vec::with_capacity((h * w) as usize);
            for _ in 0..h * w {
                m.push(c.u32()?);
            }
            Some((h, w, m))
        } else {
            None
        };
        zones.push(Zone { name: zname, kind: zkind, leds_count: count, matrix });
    }
    let num_leds = c.u16()?;
    let mut leds = Vec::new();
    for _ in 0..num_leds {
        leds.push(c.str()?);
        c.u32()?;
    }
    Ok(Controller { kind, name, vendor, description, version, serial, location, modes, zones, leds })
}

pub fn kind_of(t: i32) -> DeviceKind {
    match t {
        0 => DeviceKind::Motherboard,
        1 => DeviceKind::Ram,
        2 => DeviceKind::Gpu,
        3 => DeviceKind::Cooler,
        4 => DeviceKind::LedStrip,
        5 => DeviceKind::Keyboard,
        6 => DeviceKind::Mouse,
        7 => DeviceKind::Mousepad,
        8 => DeviceKind::Headset,
        9 => DeviceKind::HeadsetStand,
        10 => DeviceKind::Controller,
        11 => DeviceKind::Light,
        12 => DeviceKind::Speaker,
        15 => DeviceKind::Case,
        16 => DeviceKind::Microphone,
        18 => DeviceKind::Keypad,
        _ => DeviceKind::Other,
    }
}

/// Lay the controller's LEDs out in space: matrix zones as a key grid,
/// linear zones as strips, stacked top to bottom.
pub fn layout_of(ctrl: &Controller) -> Layout {
    const PITCH: f32 = 19.0;
    let mut leds = Vec::new();
    let mut y = 0.0f32;
    let mut width = 0.0f32;
    let mut base = 0usize;
    for z in &ctrl.zones {
        let n = z.leds_count as usize;
        match &z.matrix {
            Some((h, w, m)) => {
                // place in index order so colours line up with OpenRGB's LED order
                let mut pos = vec![None; n];
                for r in 0..*h {
                    for col in 0..*w {
                        let idx = m[(r * w + col) as usize];
                        if (idx as usize) < n {
                            pos[idx as usize] = Some(((col as f32 + 0.5) * PITCH, y + (r as f32 + 0.5) * PITCH));
                        }
                    }
                }
                for (i, p) in pos.into_iter().enumerate() {
                    let (px, py) = p.unwrap_or(((i as f32 + 0.5) * PITCH, y));
                    leds.push(Led { x: px, y: py, label: label(ctrl, base + i), w: Some(PITCH - 2.0), h: Some(PITCH - 2.0) });
                }
                width = width.max(*w as f32 * PITCH);
                y += *h as f32 * PITCH;
            }
            None => {
                let pitch = if n > 1 { 12.0 } else { PITCH };
                for i in 0..n {
                    leds.push(Led { x: (i as f32 + 0.5) * pitch, y: y + 5.0, label: label(ctrl, base + i), w: None, h: None });
                }
                width = width.max(n as f32 * pitch);
                y += 14.0;
            }
        }
        base += n;
    }
    Layout { width: width.max(10.0), height: y.max(10.0), leds }
}

fn label(ctrl: &Controller, i: usize) -> Option<String> {
    ctrl.leds.get(i).map(|s| s.trim_start_matches("Key: ").to_string())
}

pub struct OpenRgb {
    addr: String,
    stream: Option<TcpStream>,
    proto: u32,
    /// device id -> controller index
    index: Vec<String>,
}

impl OpenRgb {
    pub fn new(host: &str, port: u16) -> Self {
        Self { addr: format!("{host}:{port}"), stream: None, proto: 0, index: Vec::new() }
    }

    fn connect(&mut self) -> Result<&mut TcpStream> {
        if self.stream.is_none() {
            let addr = self
                .addr
                .to_socket_addrs()?
                .next()
                .ok_or_else(|| Error::Other(format!("cannot resolve {}", self.addr)))?;
            let s = TcpStream::connect_timeout(&addr, Duration::from_millis(400))?;
            s.set_nodelay(true)?;
            s.set_read_timeout(Some(Duration::from_secs(2)))?;
            self.stream = Some(s);
            self.send(0, pkt::SET_CLIENT_NAME, b"QUASAR\0")?;
            self.send(0, pkt::REQUEST_PROTOCOL_VERSION, &MAX_PROTOCOL.to_le_bytes())?;
            let reply = self.recv(pkt::REQUEST_PROTOCOL_VERSION)?;
            let server = u32::from_le_bytes(reply.get(..4).and_then(|b| b.try_into().ok()).unwrap_or([0; 4]));
            self.proto = server.min(MAX_PROTOCOL);
        }
        Ok(self.stream.as_mut().unwrap())
    }

    fn send(&mut self, dev: u32, id: u32, payload: &[u8]) -> Result<()> {
        let s = self.stream.as_mut().ok_or_else(|| Error::Other("not connected".into()))?;
        let mut buf = Vec::with_capacity(16 + payload.len());
        buf.extend_from_slice(&header(dev, id, payload.len() as u32));
        buf.extend_from_slice(payload);
        if let Err(e) = s.write_all(&buf) {
            self.stream = None;
            return Err(e.into());
        }
        Ok(())
    }

    /// Read packets until one with `want` arrives (skipping notifications).
    fn recv(&mut self, want: u32) -> Result<Vec<u8>> {
        let s = self.stream.as_mut().ok_or_else(|| Error::Other("not connected".into()))?;
        loop {
            let mut h = [0u8; 16];
            s.read_exact(&mut h)?;
            if &h[..4] != b"ORGB" {
                self.stream = None;
                return Err(Error::Protocol("bad magic".into()));
            }
            let id = u32::from_le_bytes(h[8..12].try_into().unwrap());
            let len = u32::from_le_bytes(h[12..16].try_into().unwrap()) as usize;
            let mut body = vec![0u8; len];
            s.read_exact(&mut body)?;
            if id == want {
                return Ok(body);
            }
        }
    }

    fn controller_index(&self, device_id: &str) -> Option<u32> {
        self.index.iter().position(|d| d == device_id).map(|i| i as u32)
    }
}

impl Backend for OpenRgb {
    fn id(&self) -> &'static str {
        "openrgb"
    }
    fn name(&self) -> &'static str {
        "OpenRGB"
    }

    fn scan(&mut self) -> Result<Vec<DeviceInfo>> {
        self.stream = None;
        self.connect()?;
        self.send(0, pkt::REQUEST_CONTROLLER_COUNT, &[])?;
        let count = u32::from_le_bytes(self.recv(pkt::REQUEST_CONTROLLER_COUNT)?[..4].try_into().unwrap());
        let mut out = Vec::new();
        self.index.clear();
        for i in 0..count {
            let proto = self.proto;
            self.send(i, pkt::REQUEST_CONTROLLER_DATA, &proto.to_le_bytes())?;
            let body = self.recv(pkt::REQUEST_CONTROLLER_DATA)?;
            let ctrl = parse_controller(&body, proto)?;
            let key = if ctrl.serial.is_empty() { ctrl.location.clone() } else { ctrl.serial.clone() };
            let id = format!("openrgb:{}:{}", ctrl.name, key);
            // take over the LEDs; hardware effects stay available in OpenRGB
            self.send(i, pkt::SET_CUSTOM_MODE, &[])?;
            self.index.push(id.clone());
            out.push(DeviceInfo {
                id,
                name: ctrl.name.clone(),
                vendor: if ctrl.vendor.is_empty() { "Unknown".into() } else { ctrl.vendor.clone() },
                kind: kind_of(ctrl.kind),
                backend: "openrgb".into(),
                firmware: Some(ctrl.version.clone()).filter(|s| !s.is_empty()),
                serial: Some(ctrl.serial.clone()).filter(|s| !s.is_empty()),
                layout: layout_of(&ctrl),
                caps: Capabilities { per_led: true, brightness: true, hardware_modes: ctrl.modes.clone(), ..Default::default() },
                virtual_device: false,
            });
        }
        Ok(out)
    }

    fn write_leds(&mut self, device_id: &str, colors: &[Rgb]) -> Result<()> {
        let idx = self.controller_index(device_id).ok_or_else(|| Error::DeviceNotFound(device_id.into()))?;
        self.connect()?;
        self.send(idx, pkt::UPDATE_LEDS, &update_leds_payload(colors))
    }

    fn apply_settings(&mut self, _device_id: &str, _s: &DeviceSettings) -> Result<()> {
        Ok(()) // OpenRGB is lighting only
    }

    fn status(&mut self, _device_id: &str) -> Option<DeviceStatus> {
        Some(DeviceStatus { connected: self.stream.is_some(), battery: None, charging: false })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bstr(v: &mut Vec<u8>, s: &str) {
        v.extend_from_slice(&((s.len() + 1) as u16).to_le_bytes());
        v.extend_from_slice(s.as_bytes());
        v.push(0);
    }

    /// A controller blob shaped exactly as OpenRGB serialises it.
    fn blob(proto: u32) -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&0u32.to_le_bytes());
        v.extend_from_slice(&5i32.to_le_bytes()); // keyboard
        bstr(&mut v, "Test Keyboard");
        if proto >= 1 {
            bstr(&mut v, "Acme");
        }
        bstr(&mut v, "desc");
        bstr(&mut v, "1.2");
        bstr(&mut v, "SN1");
        bstr(&mut v, "HID: /dev/hidraw0");
        v.extend_from_slice(&1u16.to_le_bytes()); // modes
        v.extend_from_slice(&0i32.to_le_bytes());
        bstr(&mut v, "Direct");
        let words = if proto >= 3 { 4 + 2 + 3 + 1 + 2 } else { 4 + 3 + 2 };
        for _ in 0..words {
            v.extend_from_slice(&0u32.to_le_bytes());
        }
        v.extend_from_slice(&1u16.to_le_bytes()); // one mode colour
        v.extend_from_slice(&[1, 2, 3, 0]);
        v.extend_from_slice(&2u16.to_le_bytes()); // zones
        bstr(&mut v, "Keys");
        v.extend_from_slice(&2i32.to_le_bytes());
        for n in [3u32, 3, 3] {
            v.extend_from_slice(&n.to_le_bytes());
        }
        v.extend_from_slice(&(8u16 + 16).to_le_bytes());
        v.extend_from_slice(&2u32.to_le_bytes()); // h
        v.extend_from_slice(&2u32.to_le_bytes()); // w
        for i in [0u32, 1, 2, u32::MAX] {
            v.extend_from_slice(&i.to_le_bytes());
        }
        bstr(&mut v, "Underglow");
        v.extend_from_slice(&1i32.to_le_bytes());
        for n in [2u32, 2, 2] {
            v.extend_from_slice(&n.to_le_bytes());
        }
        v.extend_from_slice(&0u16.to_le_bytes());
        v.extend_from_slice(&5u16.to_le_bytes()); // leds
        for name in ["Key: Q", "Key: W", "Key: A", "Glow 1", "Glow 2"] {
            bstr(&mut v, name);
            v.extend_from_slice(&0u32.to_le_bytes());
        }
        v.extend_from_slice(&5u16.to_le_bytes());
        v.extend_from_slice(&[0; 20]);
        v
    }

    #[test]
    fn parses_controller_v3_and_v0() {
        for proto in [0, 3] {
            let c = parse_controller(&blob(proto), proto).unwrap();
            assert_eq!(c.name, "Test Keyboard");
            assert_eq!(c.vendor, if proto >= 1 { "Acme" } else { "" });
            assert_eq!(c.modes, vec!["Direct"]);
            assert_eq!(c.zones.len(), 2);
            assert_eq!(c.zones[0].matrix.as_ref().unwrap().2.len(), 4);
            assert_eq!(c.leds.len(), 5);
            let l = layout_of(&c);
            assert_eq!(l.leds.len(), 5);
            assert_eq!(l.leds[0].label.as_deref(), Some("Q"));
            // A is at row 1, col 0
            assert!(l.leds[2].y > l.leds[0].y && (l.leds[2].x - l.leds[0].x).abs() < 1e-4);
        }
    }

    #[test]
    fn truncated_blob_errors() {
        let b = blob(3);
        assert!(parse_controller(&b[..b.len() / 2], 3).is_err());
    }

    #[test]
    fn packet_shapes() {
        let h = header(2, pkt::UPDATE_LEDS, 14);
        assert_eq!(&h[..4], b"ORGB");
        assert_eq!(u32::from_le_bytes(h[4..8].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(h[8..12].try_into().unwrap()), 1050);
        let p = update_leds_payload(&[Rgb::new(1, 2, 3), Rgb::new(4, 5, 6)]);
        assert_eq!(p.len(), 14);
        assert_eq!(u32::from_le_bytes(p[..4].try_into().unwrap()), 14);
        assert_eq!(&p[6..10], &[1, 2, 3, 0]);
    }
}
