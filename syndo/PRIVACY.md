# SEND private messaging beta

New direct and group messages use libsodium 0.8.4 authenticated public-key
boxes (X25519 / XSalsa20-Poly1305), with a fresh random 192-bit nonce for every
recipient copy. The encrypted payload binds sender and channel IDs. The
server retains only the envelope and ciphertext. Each attachment has a random
secretbox key and nonce; its original filename, media type and key travel inside
the encrypted message. The stored file has a generic name and ciphertext bytes.
The browser decrypts files to temporary blob URLs and revokes those URLs on
unmount. Native notifications omit DM contents.

The private identity key stays in the account's IndexedDB store on the device.
Only the public key is registered. Accounts cannot silently replace this key.
A recovery key can be shown in Privacy & safety and imported on another device.
It must be kept secret, preferably in a password manager. SEND cannot recover
lost private keys. Password reset does not recover encrypted history.

Contact public keys are pinned on first use. A changed key blocks sending and
decryption. Users must compare the displayed fingerprints through another
trusted channel to verify a first contact; a first-use directory alone cannot
prove identity. Profile/account metadata, membership, timestamps, ciphertext
size, replies and reactions are not hidden. New group members cannot decrypt
older copies which were not addressed to them. Existing plaintext history is
not retroactively encrypted and is labelled separately.

This is an unaudited beta construction using standard cryptographic primitives,
not the Signal protocol. It has no forward secrecy or post-compromise security:
compromising a long-term key can expose retained messages. A compromised endpoint,
malicious web update or XSS can also expose device-held keys and plaintext.
Do not market this as audited security or as protection from a compromised client.

Calls use Cloudflare SFU with WebRTC transport encryption. They are not yet
end-to-end encrypted at the media frame layer. No recording or transcription
is enabled by SEND. The SFU App Secret stays in Worker/container secrets and
never reaches clients. Backend routes verify channel access and session ownership
for every signaling operation and restrict remote track references to the same
channel. Leaving, revoking a session or losing permissions closes media tracks.

Native WebRTC echo cancellation and noise suppression run locally. A Krisp
virtual microphone may be selected when installed. Embedded Krisp SDK processing
requires licensed credentials and is not claimed to be enabled.
