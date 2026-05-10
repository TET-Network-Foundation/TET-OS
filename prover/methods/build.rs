fn main() {
    println!("cargo:rerun-if-env-changed=RISC0_SKIP_BUILD");
    if std::env::var("RISC0_SKIP_BUILD")
        .ok()
        .as_deref()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        let out_dir = std::env::var("OUT_DIR").unwrap();
        let dst = std::path::Path::new(&out_dir).join("methods.rs");
        let stub = r#"
pub const TET_TRANSFER_GUEST_ID: [u32; 8] = [0u32; 8];
pub const TET_TRANSFER_GUEST_ELF: &[u8] = &[];
pub const TET_AI_INFERENCE_GUEST_ID: [u32; 8] = [0u32; 8];
pub const TET_AI_INFERENCE_GUEST_ELF: &[u8] = &[];
"#;
        std::fs::write(dst, stub).expect("write stub methods.rs");
        return;
    }
    risc0_build::embed_methods();
}
