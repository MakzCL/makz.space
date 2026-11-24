//! Audio analysis: samples in, 16 log-spaced bands and a beat flag out.
//! The shell captures system output (WASAPI loopback on Windows) and feeds
//! mono f32 samples here.

use crate::effects::AudioFrame;

pub const FFT_SIZE: usize = 1024;

/// In-place iterative radix-2 FFT. `re`/`im` length must be a power of two.
pub fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    debug_assert!(n.is_power_of_two() && im.len() == n);
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -std::f32::consts::TAU / len as f32;
        let (wr, wi) = (ang.cos(), ang.sin());
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0f32, 0.0f32);
            for k in 0..len / 2 {
                let (a, b) = (start + k, start + k + len / 2);
                let tr = re[b] * cr - im[b] * ci;
                let ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                let ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
        len <<= 1;
    }
}

pub struct Analyzer {
    ring: Vec<f32>,
    pos: usize,
    sample_rate: f32,
    window: Vec<f32>,
    /// Slow-moving average of bass energy, for onset detection.
    bass_avg: f32,
    since_beat: f32,
    /// Auto-gain: running peak.
    peak: f32,
}

impl Analyzer {
    pub fn new(sample_rate: u32) -> Self {
        let window = (0..FFT_SIZE).map(|i| 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / (FFT_SIZE - 1) as f32).cos()).collect();
        Self { ring: vec![0.0; FFT_SIZE], pos: 0, sample_rate: sample_rate as f32, window, bass_avg: 0.0, since_beat: 1.0, peak: 0.05 }
    }

    pub fn push(&mut self, mono: &[f32]) {
        for s in mono {
            self.ring[self.pos] = *s;
            self.pos = (self.pos + 1) % FFT_SIZE;
        }
    }

    /// Analyse the latest window. `dt` is time since the previous call.
    pub fn analyse(&mut self, dt: f32) -> AudioFrame {
        let mut re: Vec<f32> = (0..FFT_SIZE).map(|i| self.ring[(self.pos + i) % FFT_SIZE] * self.window[i]).collect();
        let mut im = vec![0.0; FFT_SIZE];
        fft(&mut re, &mut im);
        let bin_hz = self.sample_rate / FFT_SIZE as f32;
        let mut bands = [0.0f32; 16];
        // 16 log bands from 40 Hz to 16 kHz
        let (lo, hi) = (40f32.ln(), 16000f32.ln());
        for (b, band) in bands.iter_mut().enumerate() {
            let f0 = (lo + (hi - lo) * b as f32 / 16.0).exp();
            let f1 = (lo + (hi - lo) * (b + 1) as f32 / 16.0).exp();
            let (i0, i1) = (((f0 / bin_hz) as usize).max(1), ((f1 / bin_hz) as usize).clamp(2, FFT_SIZE / 2));
            let mut e = 0.0f32;
            for i in i0..i1.max(i0 + 1) {
                e = e.max((re[i] * re[i] + im[i] * im[i]).sqrt());
            }
            *band = e / (FFT_SIZE as f32 / 4.0);
        }
        let frame_peak = bands.iter().cloned().fold(0.0, f32::max);
        self.peak = (self.peak * (1.0 - dt * 0.3)).max(frame_peak).max(0.02);
        for v in &mut bands {
            *v = (*v / self.peak).sqrt().min(1.0);
        }
        let level = bands.iter().sum::<f32>() / 16.0;
        let bass = (bands[0] + bands[1] + bands[2]) / 3.0;
        self.since_beat += dt;
        let beat = bass > self.bass_avg * 1.35 + 0.08 && self.since_beat > 0.18;
        if beat {
            self.since_beat = 0.0;
        }
        self.bass_avg += (bass - self.bass_avg) * (dt * 4.0).min(1.0);
        AudioFrame { bands, level, beat }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fft_finds_a_pure_tone() {
        let n = 64;
        let mut re: Vec<f32> = (0..n).map(|i| (std::f32::consts::TAU * 5.0 * i as f32 / n as f32).sin()).collect();
        let mut im = vec![0.0; n];
        fft(&mut re, &mut im);
        let mag: Vec<f32> = (0..n / 2).map(|i| (re[i] * re[i] + im[i] * im[i]).sqrt()).collect();
        let peak = mag.iter().enumerate().max_by(|a, b| a.1.total_cmp(b.1)).unwrap().0;
        assert_eq!(peak, 5);
    }

    #[test]
    fn bass_tone_lights_low_bands_and_beats() {
        let sr = 48000;
        let mut a = Analyzer::new(sr);
        let _ = a.analyse(0.016); // silence primes the average
        let tone: Vec<f32> = (0..FFT_SIZE).map(|i| (std::f32::consts::TAU * 60.0 * i as f32 / sr as f32).sin()).collect();
        a.push(&tone);
        let f = a.analyse(0.016);
        assert!(f.bands[0] > 0.5 || f.bands[1] > 0.5, "{:?}", f.bands);
        assert!(f.bands[0].max(f.bands[1]) > f.bands[12] * 2.0);
        assert!(f.beat);
    }
}
