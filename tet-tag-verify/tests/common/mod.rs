//! The pinned canonical texts and hashes, shared by the library tests (doc_formats.rs) and the
//! CLI tests (cli.rs), so the two can't drift apart. Changing one of these means a new format
//! version, not a new expected value.
#![allow(dead_code)]

pub const TAG_ID: &str = "3b4b5ea931583eaba51ac4a5d84c4e5db1c47da6f00e03a00e15bb93f87afdb3";
pub const REG_JSON: &str = "{\"chip\":\"ntag424dna_tt\",\"counter_at_registration\":61,\"kind\":\"tet_tag_registration\",\"product\":{\"images_sha256\":[\"1111111111111111111111111111111111111111111111111111111111111111\"],\"label\":\"Test bag\",\"ref\":\"TB-1\"},\"tag_id\":\"3b4b5ea931583eaba51ac4a5d84c4e5db1c47da6f00e03a00e15bb93f87afdb3\",\"v\":1,\"verifier\":\"https://verify.example.org\"}";
pub const REG_SHA: &str = "de1186b4cf78e13369fe56c7d7d8a2bdf0258b38d03f4aa6b1bc65aae887b799";
pub const CLAIM_JSON: &str = "{\"kind\":\"tet_tag_claim\",\"new_owner\":\"tet1owner\",\"previous_claim_sha256\":null,\"registration_record_sha256\":\"de1186b4cf78e13369fe56c7d7d8a2bdf0258b38d03f4aa6b1bc65aae887b799\",\"release_sha256\":null,\"tag_id\":\"3b4b5ea931583eaba51ac4a5d84c4e5db1c47da6f00e03a00e15bb93f87afdb3\",\"tap\":{\"counter\":62,\"tamper\":\"closed\"},\"v\":1,\"verifier_attestation_sha256\":\"2222222222222222222222222222222222222222222222222222222222222222\"}";
pub const CLAIM_SHA: &str = "fae36f8f8666e1721235c455ca9bc0bdb792ae1bb7be519f7de1fda8f4c1058b";
