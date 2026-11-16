//! DeepFilterNet3 in WebAssembly for SEND's microphone pipeline. Plain C-ABI exports (no JS glue), so an
//! AudioWorklet can instantiate it directly: write a 10 ms frame (480 samples, 48 kHz mono) at `df_input()`,
//! call `df_process()`, read the cleaned frame at `df_output()`. The model is embedded (deep-filter-rt).
use deep_filter_rt::tract::{DfParams, DfTract, RuntimeParams};
use ndarray::{ArrayView2, ArrayViewMut2};

struct State { df: DfTract, input: Vec<f32>, output: Vec<f32> }
static mut STATE: Option<State> = None;

#[allow(static_mut_refs)]
fn state() -> Option<&'static mut State> { unsafe { STATE.as_mut() } }

/// Load the model. `atten_lim_db`: how far noise may be pushed down (100 = no limit). Returns the frame size
/// (samples per call), or 0 if the model couldn't load.
#[no_mangle]
pub extern "C" fn df_init(atten_lim_db: f32) -> u32 {
  let rp = RuntimeParams::default_with_ch(1).with_atten_lim(atten_lim_db);
  match DfTract::new(DfParams::default(), &rp) {
    Ok(df) => { let n = df.hop_size; unsafe { STATE = Some(State { df, input: vec![0.0; n], output: vec![0.0; n] }); } n as u32 }
    Err(_) => 0,
  }
}

#[no_mangle]
pub extern "C" fn df_input() -> *mut f32 { state().map(|s| s.input.as_mut_ptr()).unwrap_or(core::ptr::null_mut()) }
#[no_mangle]
pub extern "C" fn df_output() -> *mut f32 { state().map(|s| s.output.as_mut_ptr()).unwrap_or(core::ptr::null_mut()) }
#[no_mangle]
pub extern "C" fn df_delay() -> u32 { state().map(|s| s.df.delay() as u32).unwrap_or(0) }

/// Clean one frame. Returns the local SNR estimate in dB (NaN on error: the output is then the input).
#[no_mangle]
pub extern "C" fn df_process() -> f32 {
  let Some(s) = state() else { return f32::NAN };
  let n = s.input.len();
  let noisy = ArrayView2::from_shape((1, n), &s.input).unwrap();
  let enhanced = ArrayViewMut2::from_shape((1, n), &mut s.output).unwrap();
  match s.df.process(noisy, enhanced) { Ok(lsnr) => lsnr, Err(_) => { s.output.copy_from_slice(&s.input); f32::NAN } }
}

#[no_mangle]
pub extern "C" fn df_set_atten_lim(atten_lim_db: f32) { if let Some(s) = state() { s.df.set_atten_lim(atten_lim_db); } }
