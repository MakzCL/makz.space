//! Minimal standard base64 encoder, used to ship preview frames over IPC
//! without pulling in a dependency for twenty lines of code.

const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn encode(input: &[u8]) -> String {
    let mut out = Vec::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63]);
        out.push(T[(n >> 12) as usize & 63]);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] } else { b'=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] } else { b'=' });
    }
    String::from_utf8(out).expect("base64 alphabet is ascii")
}

#[cfg(test)]
mod tests {
    #[test]
    fn rfc4648_vectors() {
        assert_eq!(super::encode(b""), "");
        assert_eq!(super::encode(b"f"), "Zg==");
        assert_eq!(super::encode(b"fo"), "Zm8=");
        assert_eq!(super::encode(b"foo"), "Zm9v");
        assert_eq!(super::encode(b"foobar"), "Zm9vYmFy");
    }
}
