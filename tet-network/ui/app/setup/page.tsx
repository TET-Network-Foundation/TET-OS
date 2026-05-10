/* eslint-disable @next/next/no-html-link-for-pages */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createVaultWithMnemonic, unlockVault } from "../lib/pin_vault";
import { generateMnemonic12 } from "../lib/bip39_12";
import { mldsa44KeypairFromMnemonic, pqcInit } from "../lib/pqc";
import { useT } from "../i18n/useT";
import * as bip39 from "bip39";

export default function Setup() {
  const r = useRouter();
  const mounted = useRef(false);
  const { t } = useT();

  const [flow, setFlow] = useState<"create" | "import">(() => {
    try {
      const mode = new URLSearchParams(window.location.search).get("mode") ?? "";
      return mode === "import" ? "import" : "create";
    } catch {
      return "create";
    }
  });
  const [pin, setPin] = useState("");
  const [mnemonic, setMnemonic] = useState<string>("");
  const [importPhrase, setImportPhrase] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [fatalErr, setFatalErr] = useState<string>("");

  const [pqcStatus, setPqcStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [pqcErr, setPqcErr] = useState<string>("");

  const [backedUp, setBackedUp] = useState(false);
  const [tosOk, setTosOk] = useState(false);
  const mnemonicNoSpaces = useMemo(() => (mnemonic ?? "").replace(/\s+/g, ""), [mnemonic]);
  const [phraseCopied, setPhraseCopied] = useState(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    // Step 1: remove old session garbage (exact keys requested).
    try {
      localStorage.removeItem("tet.session.vault");
    } catch {
      // ignore
    }
    try {
      localStorage.removeItem("tet.session.pin6");
    } catch {
      // ignore
    }
    // Also remove the actual persisted vault/session keys used by this UI.
    try {
      sessionStorage.removeItem("tet.session.pin6");
    } catch {
      // ignore
    }
  }, [r]);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Step 2: await Wasm init first, then generate the 12 words.
      setFatalErr("");
      setPqcStatus("loading");
      setPqcErr("");
      try {
        await pqcInit();
        if (!alive) return;
        setPqcStatus("ok");
      } catch (e: unknown) {
        if (!alive) return;
        setPqcStatus("err");
        const msg = e instanceof Error ? e.message : String(e);
        const shown = (msg || "PQC Wasm init failed").toString();
        setPqcErr(shown);
        setFatalErr(`Setup failed: ${shown}`);
        return;
      }

      try {
        if (flow === "create") {
          const { mnemonic12 } = await generateMnemonic12();
          if (!alive) return;
          setMnemonic(mnemonic12);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!alive) return;
        setFatalErr(`Setup failed: ${(msg || "mnemonic generation failed").toString()}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [flow]);

  async function onCreate(e?: unknown) {
    try {
      const ev = e as { preventDefault?: () => void } | undefined;
      ev?.preventDefault?.();
    } catch {
      // ignore
    }
    setFatalErr("");
    setBusy(true);
    try {
      const master = pin.trim();
      if (!master || master.length < 8) {
        setFatalErr(`${t("setup.errPrefix")} ${t("setup.errPinFormat")}`);
        return;
      }
      let mnemonicNorm = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
      if (!mnemonicNorm) {
        const g = await generateMnemonic12();
        mnemonicNorm = g.mnemonic12.trim().toLowerCase();
      }

      // Hybrid seed: 12-word mnemonic binds both Ed25519 + ML-DSA-44 identity material.
      let pqc: { pubkey_b64: string; keypair_b64: string };
      try {
        pqc = await mldsa44KeypairFromMnemonic(mnemonicNorm);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`PQC keygen failed: ${msg}`);
      }
      const created = await createVaultWithMnemonic(master, mnemonicNorm, pqc);

      // Verify persistence + unlock works before moving on.
      const raw = typeof window !== "undefined" ? window.localStorage.getItem("tet.vault.v1") : null;
      if (!raw) throw new Error("vault persistence failed: localStorage[tet.vault.v1] missing after create");

      try {
        await unlockVault(master);
      } catch (e: unknown) {
        console.error("[setup] unlockVault failed after create (continuing to /os anyway)", e);
      }
      window.location.assign("/os");
    } catch (e: unknown) {
      console.error("[setup] Vault creation failed", e);
      const msg = e instanceof Error ? e.message : String(e);
      setFatalErr(`Setup failed: ${(msg || "setup failed").toString()}`);
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    setFatalErr("");
    // Import should NOT be blocked by creation cooldown.
    if (!tosOk) {
      setFatalErr(`${t("setup.errPrefix")} ${t("setup.tosRequiredErr")}`);
      return;
    }
    if (pqcStatus !== "ok") {
      const details = pqcErr ? ` ${pqcErr}` : "";
      setFatalErr(`${t("setup.errPrefix")} ${t("setup.errPqcNotReady")} (${pqcStatus}).${details}`.trim());
      return;
    }
    if (pin.trim().length < 8) {
      setFatalErr(`${t("setup.errPrefix")} ${t("setup.errPinFormat")}`);
      return;
    }
    const phraseNorm = importPhrase.trim().toLowerCase().replace(/\s+/g, " ");
    const wc = phraseNorm.split(" ").filter(Boolean).length;
    if (wc < 12 || wc > 24 || !bip39.validateMnemonic(phraseNorm)) {
      setFatalErr(`${t("setup.errPrefix")} Invalid recovery phrase (12–24 words).`);
      return;
    }

    setBusy(true);
    try {
      let pqc: { pubkey_b64: string; keypair_b64: string };
      try {
        pqc = await mldsa44KeypairFromMnemonic(phraseNorm);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`PQC keygen failed during import: ${msg}`);
      }
      const created = await createVaultWithMnemonic(pin, phraseNorm, pqc);

      // If this device has no genesis counter yet, treat this as Founder recovery.
      try {
        const COUNT_KEY = "tet.genesis.wallet_count.v1";
        const ALLOC_KEY = "tet.genesis.alloc.v1";
        const prev = Number(localStorage.getItem(COUNT_KEY) ?? "0");
        const index = prev > 0 ? prev + 1 : 1;
        if (!prev) localStorage.setItem(COUNT_KEY, String(index));
        const mapRaw = localStorage.getItem(ALLOC_KEY) ?? "{}";
        const map = JSON.parse(mapRaw) as Record<
          string,
          { kind: "founder" | "genesis"; index: number; tet: number; stevemon: number }
        >;
        const isFounder = index === 1;
        map[created.record.wallet_id_hex] = {
          kind: isFounder ? "founder" : "genesis",
          index,
          tet: isFounder ? 2_500_000_000 : 50_000,
          stevemon: 5_000_000,
        };
        localStorage.setItem(ALLOC_KEY, JSON.stringify(map));
      } catch {
        // ignore
      }

      await unlockVault(pin);
      window.location.assign("/os");
    } catch (e: unknown) {
      console.error("[setup] Import failed", e);
      const msg = e instanceof Error ? e.message : String(e);
      setFatalErr(`Import failed: ${(msg || "import failed").toString()}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <div className="leading-tight">
            <div className="text-white text-3xl font-bold">{t("setup.headerTitle")}</div>
            <div className="mt-1 text-slate-400 text-sm">{t("setup.headerSub")}</div>
          </div>
          <a href="/" className="text-sm font-semibold text-slate-300 hover:text-white">
            {t("setup.homeLink")}
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-6">
            <div className="space-y-6">
              {fatalErr ? (
                <div className="border border-rose-200 bg-rose-50 p-4 rounded-md text-sm text-rose-800">
                  {fatalErr}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">
                  {flow === "create" ? "Create new wallet" : "Import existing wallet"}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFatalErr("");
                      setFlow("create");
                      r.replace("/setup");
                    }}
                    className={[
                      "rounded-lg px-3 py-2 text-xs font-semibold",
                      flow === "create" ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFatalErr("");
                      setFlow("import");
                      r.replace("/setup?mode=import");
                    }}
                    className={[
                      "rounded-lg px-3 py-2 text-xs font-semibold",
                      flow === "import" ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50",
                    ].join(" ")}
                  >
                    Import
                  </button>
                </div>
              </div>

              {flow === "create" ? (
                <div className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
                  <div className="text-slate-900 text-sm font-semibold">{t("setup.recoveryTitle")}</div>
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recovery phrase (no spaces)</div>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(mnemonicNoSpaces);
                            setPhraseCopied(true);
                            window.setTimeout(() => setPhraseCopied(false), 900);
                          } catch {
                            setPhraseCopied(false);
                          }
                        }}
                        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        {phraseCopied ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <div className="mt-3 font-mono text-sm break-all text-slate-900">{mnemonicNoSpaces || t("setup.generating")}</div>
                  </div>
                </div>
              ) : (
                <div className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
                  <div className="text-slate-900 text-sm font-semibold">Recovery phrase (12–24 words)</div>
                  <textarea
                    value={importPhrase}
                    onChange={(e) => setImportPhrase(e.target.value)}
                    placeholder="word1 word2 word3 …"
                    className="mt-3 min-h-[110px] w-full rounded-xl border border-slate-300 bg-white p-4 font-mono text-sm text-slate-900 outline-none focus:border-yellow-400"
                  />
                  <div className="mt-2 text-xs text-slate-500">
                    Import restores your wallet locally. Never paste your phrase into websites you do not trust.
                  </div>
                </div>
              )}

              <div className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{t("setup.step2Kicker")}</div>
                <div className="mt-2 text-sm text-slate-600">{t("setup.step2Body")}</div>
                <div className="mt-4 flex items-start gap-3">
                  <input
                    id="backup"
                    type="checkbox"
                    checked={backedUp}
                    onChange={(e) => setBackedUp(e.target.checked)}
                    className="mt-1 h-4 w-4 accent-yellow-400"
                  />
                  <label htmlFor="backup" className="text-sm text-slate-700">
                    {t("setup.step2Checkbox")}
                  </label>
                </div>
              </div>

              {flow === "create" && backedUp ? (
                <>
                  <div className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{t("setup.step3Kicker")}</div>
                    <div className="mt-2 text-sm text-slate-600">{t("setup.step3Body")}</div>
                    <input
                      autoFocus
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onCreate();
                      }}
                      type="password"
                      placeholder="Enter PIN (min. 8 characters)"
                      className="mt-4 h-11 w-full rounded-xl border border-slate-300 bg-white px-4 font-mono text-base text-slate-900 outline-none focus:border-yellow-400"
                    />
                    <div className="mt-2 text-xs font-mono text-slate-500 opacity-80">PIN must be at least 8 characters.</div>
                  </div>

                  <div className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
                    <div className="mt-1 flex items-start gap-3">
                      <input
                        id="tos"
                        type="checkbox"
                        checked={tosOk}
                        onChange={(e) => setTosOk(e.target.checked)}
                        className="mt-1 h-4 w-4 accent-yellow-400"
                      />
                      <label htmlFor="tos" className="text-sm text-slate-700 leading-relaxed">
                        {t("setup.tosLabel")}
                      </label>
                    </div>

                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                        {t("setup.tosDocTitle")}
                      </div>
                      <div className="mt-2 text-xs leading-relaxed text-slate-600">{t("setup.tosDocPreamble")}</div>

                      <div className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-4">
                        <ol className="space-y-4 text-xs leading-relaxed text-slate-700">
                          <li>
                            <div className="font-semibold text-slate-900">{t("setup.tos1_1Title")}</div>
                            <div className="mt-1">{t("setup.tos1_1Body")}</div>
                          </li>
                          <li>
                            <div className="font-semibold text-slate-900">{t("setup.tos1_2Title")}</div>
                            <div className="mt-1">{t("setup.tos1_2Body")}</div>
                          </li>
                          <li>
                            <div className="font-semibold text-slate-900">{t("setup.tos1_3Title")}</div>
                            <div className="mt-1">{t("setup.tos1_3Body")}</div>
                          </li>
                          <li>
                            <div className="font-semibold text-slate-900">{t("setup.tos1_4Title")}</div>
                            <div className="mt-1">{t("setup.tos1_4Body")}</div>
                          </li>
                        </ol>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => onCreate(e)}
                    disabled={busy || pin.trim().length < 8}
                    className="h-12 w-full bg-yellow-400 px-4 text-sm font-bold text-black hover:bg-yellow-300 disabled:opacity-60 rounded-xl"
                  >
                    {busy ? t("setup.working") : t("setup.createBtn")}
                  </button>
                </>
              ) : null}

              {flow === "import" ? (
                <>
                  <div className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{t("setup.step3Kicker")}</div>
                    <div className="mt-2 text-sm text-slate-600">{t("setup.step3Body")}</div>
                    <input
                      autoFocus
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onImport();
                      }}
                      type="password"
                      placeholder="Enter PIN (min. 8 characters)"
                      className="mt-4 h-11 w-full rounded-xl border border-slate-300 bg-white px-4 font-mono text-base text-slate-900 outline-none focus:border-yellow-400"
                    />
                    <div className="mt-2 text-xs font-mono text-slate-500 opacity-80">PIN must be at least 8 characters.</div>
                  </div>

                  <div className="border border-slate-200 bg-white p-5 rounded-xl shadow-sm">
                    <div className="mt-1 flex items-start gap-3">
                      <input
                        id="tos2"
                        type="checkbox"
                        checked={tosOk}
                        onChange={(e) => setTosOk(e.target.checked)}
                        className="mt-1 h-4 w-4 accent-yellow-400"
                      />
                      <label htmlFor="tos2" className="text-sm text-slate-700 leading-relaxed">
                        {t("setup.tosLabel")}
                      </label>
                    </div>
                  </div>

                  <button
                    onClick={onImport}
                    disabled={busy || pqcStatus !== "ok" || pin.trim().length < 8 || !tosOk || !importPhrase.trim()}
                    className="h-12 w-full bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60 rounded-xl"
                  >
                    {busy ? t("setup.working") : "Import & Restore Vault"}
                  </button>
                </>
              ) : null}

              <div className="border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-600 rounded-xl">
                {t("setup.footerNote").split("tet.vault.v1")[0]}
                <span className="font-mono text-slate-900">tet.vault.v1</span>
                {t("setup.footerNote").split("tet.vault.v1")[1] ?? ""}
              </div>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      localStorage.clear();
                      sessionStorage.clear();
                    } finally {
                      window.location.reload();
                    }
                  }}
                  className="text-xs font-mono text-slate-400 hover:text-slate-700 underline decoration-slate-300 underline-offset-4"
                >
                  Dev: Factory Reset
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

