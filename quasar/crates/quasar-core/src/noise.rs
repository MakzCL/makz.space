//! Small deterministic noise helpers for procedural effects.

#[inline]
pub fn hash(x: i32, y: i32, seed: u32) -> f32 {
    let mut h = (x as u32).wrapping_mul(0x27d4_eb2d) ^ (y as u32).wrapping_mul(0x1656_67b1) ^ seed.wrapping_mul(0x9e37_79b9);
    h ^= h >> 15;
    h = h.wrapping_mul(0x85eb_ca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2_ae35);
    h ^= h >> 16;
    (h & 0x00ff_ffff) as f32 / 0x00ff_ffff as f32
}

#[inline]
fn smooth(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

/// 256 lattice values and a permutation, built at compile time. Table
/// lookups make value noise several times cheaper than hashing per corner.
const fn tables() -> ([u8; 512], [f32; 256]) {
    let mut perm = [0u8; 512];
    let mut vals = [0f32; 256];
    let mut i = 0;
    while i < 256 {
        perm[i] = i as u8;
        i += 1;
    }
    let mut x: u32 = 0x9e37_79b9;
    let mut i = 255;
    while i > 0 {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        let j = (x % (i as u32 + 1)) as usize;
        let t = perm[i];
        perm[i] = perm[j];
        perm[j] = t;
        i -= 1;
    }
    let mut i = 0;
    while i < 256 {
        perm[256 + i] = perm[i];
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        vals[i] = (x & 0xffff) as f32 / 65535.0;
        i += 1;
    }
    (perm, vals)
}

const TABLES: ([u8; 512], [f32; 256]) = tables();

#[inline]
fn lattice(x: i32, y: i32, seed: u32) -> f32 {
    let (perm, vals) = (&TABLES.0, &TABLES.1);
    let xi = ((x as u32).wrapping_add(seed.wrapping_mul(97)) & 255) as usize;
    let yi = ((y as u32).wrapping_add(seed.wrapping_mul(57)) & 255) as usize;
    vals[perm[perm[xi] as usize + yi] as usize]
}

/// 2D value noise in 0..1.
pub fn value2(x: f32, y: f32, seed: u32) -> f32 {
    let (xi, yi) = (x.floor() as i32, y.floor() as i32);
    let (xf, yf) = (smooth(x - xi as f32), smooth(y - yi as f32));
    let a = lattice(xi, yi, seed);
    let b = lattice(xi + 1, yi, seed);
    let c = lattice(xi, yi + 1, seed);
    let d = lattice(xi + 1, yi + 1, seed);
    let top = a + (b - a) * xf;
    let bot = c + (d - c) * xf;
    top + (bot - top) * yf
}

/// Fractal value noise, `octaves` layers, result in roughly 0..1.
pub fn fbm(x: f32, y: f32, octaves: u32, seed: u32) -> f32 {
    let (mut sum, mut amp, mut freq, mut norm) = (0.0, 0.5, 1.0, 0.0);
    for o in 0..octaves {
        sum += amp * value2(x * freq, y * freq, seed.wrapping_add(o * 131));
        norm += amp;
        amp *= 0.5;
        freq *= 2.0;
    }
    sum / norm
}

/// xorshift PRNG for effects that spawn particles.
#[derive(Clone, Debug)]
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u32) -> Self {
        Self(seed.max(1))
    }
    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }
    pub fn f(&mut self) -> f32 {
        (self.next_u32() & 0x00ff_ffff) as f32 / 0x0100_0000 as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_noise_is_bounded_and_continuous() {
        let mut prev = value2(0.0, 0.3, 1);
        for i in 1..2000 {
            let x = i as f32 * 0.01;
            let v = value2(x, 0.3, 1);
            assert!((0.0..=1.0).contains(&v));
            assert!((v - prev).abs() < 0.05, "jump at {x}");
            prev = v;
        }
        // seeds decorrelate
        assert_ne!(value2(3.3, 1.1, 1), value2(3.3, 1.1, 2));
    }
}
