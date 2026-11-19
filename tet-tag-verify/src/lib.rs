//! Offline pieces of the genuine-tag plan (docs/plans/GENUINE_TAG.md): checking an NTAG 424 DNA
//! SUN tap against a key, deriving a tag's key from a master key (AN10922), and the two tag
//! documents with their canonical JSON and SHA-256.
//! No node. Everything except `serve` works on text and bytes with no network; `serve` is a
//! small localhost verifier around the same checks (prototype).

pub mod diversify;
pub mod docs;
pub mod report;
pub mod serve;
pub mod sun;
pub mod url;
