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
    // `risc0-build` checks whether RISC0_SKIP_BUILD is **set**, not what it is set to. Our own
    // check above is value-based, so `RISC0_SKIP_BUILD=0` -- which every caller means as "do build
    // the guest" -- fell through to here and then made `embed_methods` skip anyway. The result was
    // silent and worse than a failure: the build went green while emitting
    //
    //     pub const NEXUS_GUEST_ELF: &[u8] = &[];
    //     pub const NEXUS_GUEST_ID: [u32; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
    //
    // so the node compiled, started, and refused to prove with "guest ELF empty", while verifying
    // against an all-zero image id. Both `Dockerfile` (production default) and
    // `.github/workflows/zk-image.yml` pass `RISC0_SKIP_BUILD=0`, so the production zk image had
    // this shape.
    //
    // Removing the variable here is the one-line fix that covers every caller, rather than editing
    // each deployment config and hoping the next one remembers.
    //
    // Safety: build scripts are single-threaded at this point and this process exits shortly after.
    if std::env::var_os("RISC0_SKIP_BUILD").is_some() {
        unsafe { std::env::remove_var("RISC0_SKIP_BUILD") };
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
