fn main() {
    const RISC0_TOOLCHAIN_HELP: &str = "RISC Zero guest compilation failed or the zkVM target is unavailable. Please confirm that `cargo binstall cargo-risczero` and `cargo risczero install` have been executed, then rebuild without RISC0_SKIP_BUILD.";

    println!("cargo:rerun-if-env-changed=RISC0_SKIP_BUILD");
    // Allow bypassing guest builds when the local RISC Zero toolchain is mismatched.
    // This keeps `tet-core` compiling while we iterate on wiring.
    if std::env::var("RISC0_SKIP_BUILD")
        .ok()
        .as_deref()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
    {
        // Still emit a stub `methods.rs` so the host can compile deterministically.
        let out_dir = std::env::var("OUT_DIR").unwrap();
        let dst = std::path::Path::new(&out_dir).join("methods.rs");
        let stub = r#"
// Auto-generated stub (RISC0_SKIP_BUILD=1).
pub const NEXUS_GUEST_ID: [u32; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
pub const NEXUS_GUEST_ELF: &[u8] = &[];
"#;
        let _ = std::fs::write(dst, stub);
        return;
    }
    eprintln!("RISC Zero toolchain check: {RISC0_TOOLCHAIN_HELP}");
    std::panic::set_hook(Box::new(|info| {
        eprintln!("{RISC0_TOOLCHAIN_HELP}");
        eprintln!("{info}");
    }));
    if std::panic::catch_unwind(risc0_build::embed_methods).is_err() {
        panic!(
            "RISC Zero guest compilation failed. Please confirm that `cargo binstall cargo-risczero` and `cargo risczero install` have been executed, then rebuild without RISC0_SKIP_BUILD."
        );
    }
}
