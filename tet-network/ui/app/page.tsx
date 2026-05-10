"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cryptoWaitReady, mnemonicValidate } from "@polkadot/util-crypto";
import { loadSession, randomHex, saveSession, type SessionV0 } from "./lib/session";
import { generateMnemonic12 } from "./lib/bip39_12";
import {
  createInAppWalletWithMnemonic,
  isValidWalletPin,
  readInAppWalletRecord,
  unlockInAppWallet,
} from "./lib/inapp_wallet";
import { vaultExists } from "./lib/pin_vault";
import {
  clearWalletStore,
  hasFounderMarker,
  loadWalletStore,
  setFounderMarker,
  sha256Hex,
} from "./lib/wallet_store";
import { saveTxs, type TxRowV0 } from "./lib/tx_store";

export default function Home() {
  const router = useRouter();
  const [existing, setExisting] = useState<SessionV0 | null>(null);
  const [hasWallet, setHasWallet] = useState(false);
  const [wizard, setWizard] = useState<
    "welcome" | "incentive" | "mnemonic" | "pin_set" | "pin_login" | "recover" | "import_inapp"
  >("welcome");
  /** Which blob `pin_login` unlocks (`legacy` = tet.wallet.v0). */
  const [loginTarget, setLoginTarget] = useState<"legacy" | "inapp" | null>(null);
  const [mnemonic, setMnemonic] = useState<string>("");
  const [pin, setPin] = useState<string>("");
  const [pin2, setPin2] = useState<string>("");
  const [recoverMnemonic, setRecoverMnemonic] = useState<string>("");
  const [recoverPin, setRecoverPin] = useState<string>("");
  const [recoverPin2, setRecoverPin2] = useState<string>("");
  const [importPhrase, setImportPhrase] = useState("");
  const [importPin, setImportPin] = useState("");
  const [importPin2, setImportPin2] = useState("");
  const [err, setErr] = useState<string>("");
  const [ok, setOk] = useState<string>("");

  useEffect(() => {
    setExisting(loadSession());
    setHasWallet(!!loadWalletStore() || !!readInAppWalletRecord() || vaultExists());
  }, []);

  function goOs() {
    router.push("/os");
  }

  async function startCreateWizard() {
    setErr("");
    setOk("");
    setPin("");
    setPin2("");
    setWizard("incentive");
  }

  async function continueFromIncentive() {
    setErr("");
    setOk("");
    try {
      const g = await generateMnemonic12();
      setMnemonic(g.mnemonic12);
      setWizard("mnemonic");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg || "mnemonic generation failed");
    }
  }

  function startLoginWizard() {
    setErr("");
    setOk("");
    setPin("");
    if (loadWalletStore()) {
      setLoginTarget("legacy");
      setHasWallet(true);
      setWizard("pin_login");
      return;
    }
    if (readInAppWalletRecord()) {
      setLoginTarget("inapp");
      setHasWallet(true);
      setWizard("pin_login");
      return;
    }
    if (vaultExists()) {
      setHasWallet(true);
      setErr(
        "A wallet from /setup exists on this device. Open Sovereign OS (/os) → File → Wallet… and enter your master password there.",
      );
      return;
    }
    setHasWallet(false);
    setErr("No wallet found. Create a new account, import a mnemonic, or log in if you already saved one.");
  }

  function startImportInAppWizard() {
    setErr("");
    setOk("");
    setImportPhrase("");
    setImportPin("");
    setImportPin2("");
    setWizard("import_inapp");
  }

  function startRecoverWizard() {
    setErr("");
    setOk("");
    setRecoverMnemonic("");
    setRecoverPin("");
    setRecoverPin2("");
    setWizard("recover");
  }

  async function finishCreateWithPin() {
    setErr("");
    setOk("");
    const p = pin.trim();
    const p2 = pin2.trim();
    if (!isValidWalletPin(p)) {
      setErr("PIN must be 6–8 digits.");
      return;
    }
    if (p !== p2) {
      setErr("PIN mismatch.");
      return;
    }

    const isFounder = !hasFounderMarker();
    if (isFounder) setFounderMarker();

    try {
      await cryptoWaitReady();
      await createInAppWalletWithMnemonic(p, mnemonic);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not save encrypted wallet.");
      return;
    }
    setHasWallet(true);

    const s: SessionV0 = {
      v: 0,
      address: `0x${randomHex(20)}`,
      balance_tet: isFounder ? "2500000000.00" : "1000.00",
      created_at_ms: Date.now(),
    };
    saveSession(s);

    if (!isFounder) {
      const genesisTx: TxRowV0 = {
        ts_ms: Date.now(),
        type: "Genesis Reward",
        address: "0x0000000000000000000000000000000000000000 (Mint)",
        amount_tet: "1000.00",
        amount_stevemon: "1000000",
      };
      saveTxs({ v: 0, rows: [genesisTx] });
    }

    goOs();
  }

  async function finishLoginWithPin() {
    setErr("");
    setOk("");
    const p = pin.trim();
    if (!isValidWalletPin(p)) {
      setErr("PIN must be 6–8 digits.");
      return;
    }
    let isFounderForSession = false;
    if (loginTarget === "inapp") {
      try {
        await unlockInAppWallet(p);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Invalid PIN or wallet corrupt.");
        return;
      }
    } else {
      const ws = loadWalletStore();
      if (!ws) {
        setErr("No wallet found. Use Create Account or Import.");
        return;
      }
      const h = await sha256Hex(p);
      if (h !== ws.pin_sha256_hex) {
        setErr("Invalid PIN. Access Denied.");
        return;
      }
      isFounderForSession = ws.is_founder === true;
      const phrase = normalizeMnemonic(ws.mnemonic12);
      try {
        await createInAppWalletWithMnemonic(p, phrase);
        clearWalletStore();
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Could not upgrade wallet storage.");
        return;
      }
    }
    const cur = loadSession();
    if (!cur) {
      const s: SessionV0 = {
        v: 0,
        address: `0x${randomHex(20)}`,
        balance_tet: isFounderForSession ? "2500000000.00" : "1000.00",
        created_at_ms: Date.now(),
      };
      saveSession(s);
    }
    goOs();
  }

  async function finishImportInAppWallet() {
    setErr("");
    setOk("");
    await cryptoWaitReady();
    const phrase = normalizeMnemonic(importPhrase);
    if (!mnemonicValidate(phrase)) {
      setErr("Invalid mnemonic: enter exactly 12 valid BIP39 words.");
      return;
    }
    const p = importPin.trim();
    const p2 = importPin2.trim();
    if (!isValidWalletPin(p) || !isValidWalletPin(p2)) {
      setErr("PIN must be 6–8 digits (both fields).");
      return;
    }
    if (p !== p2) {
      setErr("PIN mismatch.");
      return;
    }
    try {
      await createInAppWalletWithMnemonic(p, phrase);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not save wallet.");
      return;
    }
    setHasWallet(true);
    const cur = loadSession();
    if (!cur) {
      const s: SessionV0 = {
        v: 0,
        address: `0x${randomHex(20)}`,
        balance_tet: "1000.00",
        created_at_ms: Date.now(),
      };
      saveSession(s);
    }
    goOs();
  }

  function normalizeMnemonic(s: string): string {
    return (s ?? "")
      .trim()
      .toLowerCase()
      .split(/\s+/g)
      .filter(Boolean)
      .join(" ");
  }

  async function recoverWallet() {
    setErr("");
    setOk("");
    const ws = loadWalletStore();
    if (!ws) {
      setErr("No wallet found. Use Create Account first.");
      return;
    }
    const mIn = normalizeMnemonic(recoverMnemonic);
    const mStored = normalizeMnemonic(ws.mnemonic12);
    if (mIn !== mStored) {
      setErr("Invalid mnemonic seed. Access denied.");
      return;
    }
    const p = recoverPin.trim();
    const p2 = recoverPin2.trim();
    if (!isValidWalletPin(p) || !isValidWalletPin(p2)) {
      setErr("PIN must be 6–8 digits.");
      return;
    }
    if (p !== p2) {
      setErr("PIN mismatch.");
      return;
    }
    try {
      await cryptoWaitReady();
      await createInAppWalletWithMnemonic(p, mIn);
      clearWalletStore();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Recovery failed.");
      return;
    }
    setOk("Wallet recovered — encrypted storage upgraded.");
    setHasWallet(true);

    // Start session if missing.
    const cur = loadSession();
    if (!cur) {
      const isFounder = ws.is_founder === true;
      const s: SessionV0 = {
        v: 0,
        address: `0x${randomHex(20)}`,
        balance_tet: isFounder ? "2500000000.00" : "1000.00",
        created_at_ms: Date.now(),
      };
      saveSession(s);
    }
    window.setTimeout(() => goOs(), 450);
  }

  return (
    <main className="min-h-screen bg-[#D6D4CE] text-black font-sans">
      <div className="mx-auto flex min-h-screen items-center justify-center px-6">
        {/* Windows dialog */}
        <div
          className={`w-full rounded-sm bg-[#D6D4CE] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] overflow-hidden ${
            wizard === "import_inapp" ? "max-w-xl" : "max-w-md"
          }`}
        >
          {/* Title bar */}
          <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-white font-bold [text-rendering:optimizeSpeed] [-webkit-font-smoothing:auto]">
            <div className="text-sm">
              {wizard === "recover"
                ? "Wallet Recovery"
                : wizard === "import_inapp"
                  ? "Import Wallet (Mnemonic)"
                  : "Login"}
            </div>
            <div className="text-sm select-none"> </div>
          </div>

          <div className="p-4">
            <div className="text-sm mb-1">TET Network // Initialization</div>
            <div className="text-sm mb-3">Setup Wizard</div>

            <div className="mb-4 rounded-none bg-[#DAD8D2] border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white p-2">
              {wizard === "welcome" ? (
                <>
                  <div className="text-xs">Local session</div>
                  <div className="mt-2 font-mono text-xs whitespace-pre-wrap">
                    {existing ? `address: ${existing.address}\nbalance_tet: ${existing.balance_tet}` : "no session"}
                  </div>
                </>
              ) : wizard === "incentive" ? (
                <>
                  <div className="text-xs mb-2">Early Adopter Incentive</div>
                  <div className="border border-t-[#808080] border-l-[#808080] border-b-white border-r-white bg-[#D6D4CE] p-2 rounded-none">
                    <div className="flex gap-3 items-start">
                      <div
                        className="w-10 h-10 bg-[#DAD8D2] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] flex items-center justify-center"
                        aria-hidden="true"
                      >
                        <div className="font-bold text-[#000080]">i</div>
                      </div>
                      <div className="text-sm">
                        NOTICE: The first 10,000 nodes will receive a Genesis Allocation of 1,000.00 TET. Current registered
                        nodes: 0
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs">Click OK to continue and generate your 12-word mnemonic.</div>
                </>
              ) : wizard === "mnemonic" ? (
                <>
                  <div className="text-xs">12-word Mnemonic Seed</div>
                  <div className="mt-2 font-mono text-xs whitespace-pre-wrap">{mnemonic}</div>
                  <div className="mt-2 text-xs">
                    WARNING: Write these words down on paper. Anyone with this seed can steal your coins.
                  </div>
                </>
              ) : wizard === "pin_set" ? (
                <>
                  <div className="text-xs">Set PIN (6–8 digits) — encrypts local keystore (AES-GCM)</div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      className="rounded-none bg-white px-2 py-1 text-sm border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white outline-none w-24"
                      inputMode="numeric"
                      type="password"
                      placeholder="PIN"
                    />
                    <input
                      value={pin2}
                      onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      className="rounded-none bg-white px-2 py-1 text-sm border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white outline-none w-24"
                      inputMode="numeric"
                      type="password"
                      placeholder="Confirm"
                    />
                  </div>
                </>
              ) : wizard === "pin_login" ? (
                <>
                  <div className="text-xs">
                    Login
                    {loginTarget === "inapp" ? (
                      <span className="block mt-1 text-[#2a4a3a] font-semibold">Enter PIN to unlock (6–8 digits)</span>
                    ) : (
                      <span className="block mt-1 text-[#2a4a3a] font-semibold">Legacy account — will upgrade to encrypted keystore</span>
                    )}
                  </div>
                  <div className="mt-2">
                    <input
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      className="rounded-none bg-white px-2 py-1 text-sm border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white outline-none w-24"
                      inputMode="numeric"
                      type="password"
                      placeholder="6–8 digit PIN"
                    />
                  </div>
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={startRecoverWizard}
                      className="text-sm text-[#000080] underline underline-offset-2 select-none"
                    >
                      Forgot PIN?
                    </button>
                  </div>
                </>
              ) : wizard === "import_inapp" ? (
                <>
                  <div className="text-xs font-semibold text-black mb-1">Bring an existing 12-word seed</div>
                  <p className="text-[11px] text-black/75 leading-snug mb-2">
                    Phrase is validated (BIP39), then encrypted with your new 8-digit PIN and saved in this browser as
                    the same format Sovereign OS uses (<span className="font-mono">tet.inapp_wallet.v1</span>).
                  </p>
                  <label className="block text-xs mb-1">12-word mnemonic</label>
                  <textarea
                    value={importPhrase}
                    onChange={(e) => setImportPhrase(e.target.value)}
                    className="w-full min-h-[100px] resize-y rounded-none bg-white px-2 py-2 text-sm border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white outline-none font-mono"
                    placeholder="word1 word2 word3 … word12"
                    spellCheck={false}
                  />
                  <div className="mt-1 text-[10px] font-mono text-black/50">
                    Words: {importPhrase.trim() ? importPhrase.trim().split(/\s+/).filter(Boolean).length : 0} / 12
                  </div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs mb-1">PIN (6–8 digits)</label>
                      <input
                        value={importPin}
                        onChange={(e) => setImportPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                        className="w-full rounded-none bg-white px-2 py-1 text-sm border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white outline-none font-mono"
                        inputMode="numeric"
                        type="password"
                        autoComplete="new-password"
                        placeholder="12345678"
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1">Confirm PIN (6–8 digits)</label>
                      <input
                        value={importPin2}
                        onChange={(e) => setImportPin2(e.target.value.replace(/\D/g, "").slice(0, 8))}
                        className="w-full rounded-none bg-white px-2 py-1 text-sm border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white outline-none font-mono"
                        inputMode="numeric"
                        type="password"
                        autoComplete="new-password"
                        placeholder="12345678"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs">Recovery Mode</div>
                  <div className="mt-2 text-xs mb-1">12-Word Mnemonic Seed</div>
                  <textarea
                    value={recoverMnemonic}
                    onChange={(e) => setRecoverMnemonic(e.target.value)}
                    className="w-full h-20 resize-none rounded-none bg-white px-2 py-1 text-sm border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white outline-none font-mono"
                    placeholder="word1 word2 ... word12"
                  />
                  <div className="mt-2 grid grid-cols-[120px_1fr] items-center gap-2">
                    <div className="text-xs">New PIN</div>
                    <input
                      value={recoverPin}
                      onChange={(e) => setRecoverPin(e.target.value)}
                      className="rounded-none bg-white px-2 py-1 text-sm border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white outline-none w-28"
                      inputMode="numeric"
                      placeholder="8-digit PIN"
                    />
                    <div className="text-xs">Confirm New PIN</div>
                    <input
                      value={recoverPin2}
                      onChange={(e) => setRecoverPin2(e.target.value)}
                      className="rounded-none bg-white px-2 py-1 text-sm border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white outline-none w-28"
                      inputMode="numeric"
                      placeholder="Confirm"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void startCreateWizard()}
                className="rounded-none bg-[#D6D4CE] px-3 py-1 text-sm border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] select-none active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white active:translate-x-px active:translate-y-px"
              >
                Create Account
              </button>
              <button
                type="button"
                onClick={startImportInAppWizard}
                className="rounded-none bg-[#D6D4CE] px-3 py-1 text-sm border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] select-none active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white active:translate-x-px active:translate-y-px"
              >
                Import Wallet
              </button>
              <button
                type="button"
                onClick={startLoginWizard}
                className="rounded-none bg-[#D6D4CE] px-3 py-1 text-sm border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] select-none active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white active:translate-x-px active:translate-y-px"
              >
                Login
              </button>
              <button
                type="button"
                disabled={
                  (wizard === "pin_login" && !isValidWalletPin(pin)) ||
                  (wizard === "pin_set" && (!isValidWalletPin(pin) || pin !== pin2)) ||
                  (wizard === "recover" &&
                    (!recoverMnemonic.trim() ||
                      !isValidWalletPin(recoverPin) ||
                      recoverPin !== recoverPin2)) ||
                  (wizard === "import_inapp" &&
                    (!importPhrase.trim() ||
                      !isValidWalletPin(importPin) ||
                      importPin !== importPin2 ||
                      importPhrase.trim().split(/\s+/).filter(Boolean).length !== 12)) ||
                  false
                }
                onClick={() => {
                  if (wizard === "recover") void recoverWallet();
                  else if (wizard === "import_inapp") void finishImportInAppWallet();
                  else if (wizard === "incentive") void continueFromIncentive();
                  else if (wizard === "mnemonic") setWizard("pin_set");
                  else if (wizard === "pin_set") void finishCreateWithPin();
                  else if (wizard === "pin_login") void finishLoginWithPin();
                  else {
                    if (!hasWallet) {
                      setErr("No wallet found. Create a new account, import a mnemonic, or log in if you already saved one.");
                      return;
                    }
                    startLoginWizard();
                  }
                }}
                className="rounded-none bg-[#D6D4CE] px-3 py-1 text-sm border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] select-none active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white active:translate-x-px active:translate-y-px disabled:opacity-60 disabled:active:translate-x-0 disabled:active:translate-y-0"
              >
                {wizard === "recover" ? "Recover Wallet" : wizard === "import_inapp" ? "Import & continue" : "OK"}
              </button>
              {wizard === "recover" || wizard === "import_inapp" ? (
                <button
                  type="button"
                  onClick={() => {
                    setErr("");
                    setOk("");
                    setWizard(loginTarget ? "pin_login" : "welcome");
                  }}
                  className="rounded-none bg-[#D6D4CE] px-3 py-1 text-sm border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] select-none active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white active:translate-x-px active:translate-y-px"
                >
                  Cancel
                </button>
              ) : null}
            </div>

            {err ? (
              <div
                className={
                  err.includes("Access Denied") ? "mt-2 text-xs text-red-600 font-bold" : "mt-2 text-xs text-red-600"
                }
              >
                Error: {err}
              </div>
            ) : null}
            {ok ? <div className="mt-2 text-xs text-black">{ok}</div> : null}
          </div>
        </div>
      </div>
    </main>
  );
}

