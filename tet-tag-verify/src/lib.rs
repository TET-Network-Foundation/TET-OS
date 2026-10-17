//! Offline pieces of the genuine-tag plan (docs/plans/GENUINE_TAG.md): checking an NTAG 424 DNA
//! SUN tap against a key, deriving a tag's key from a master key (AN10922), and the two tag
//! documents with their canonical JSON and SHA-256.
//! No network, no node: everything here works on text and bytes.

pub mod diversify;
pub mod docs;
pub mod report;
pub mod sun;
pub mod url;
