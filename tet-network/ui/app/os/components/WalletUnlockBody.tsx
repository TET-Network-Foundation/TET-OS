"use client";

import type { Dispatch, SetStateAction } from "react";
import { isValidWalletPin } from "../../lib/inapp_wallet";
import type { OsWalletStorageKind } from "../../lib/wallet_bootstrap";
import { bevel, surface, buttonBevel } from "./tokens";

const outset = bevel.outset;
const inset = bevel.inset;
const panel = surface.panel;
const field = surface.field;
const winBtn = buttonBevel;

export interface WalletUnlockBodyProps {
  persistedWalletKind: OsWalletStorageKind;
  walletUnlockErr: string;
  walletBusy: boolean;
  /** Generated 12-word phrase draft (Create flow); empty until generated. */
  newMnemonicDraft: string;
  newWalletPin: string;
  setNewWalletPin: Dispatch<SetStateAction<string>>;
  importMnemonicInput: string;
  setImportMnemonicInput: Dispatch<SetStateAction<string>>;
  importWalletPin: string;
  setImportWalletPin: Dispatch<SetStateAction<string>>;
  walletSecretInput: string;
  setWalletSecretInput: Dispatch<SetStateAction<string>>;
  /** Generate a fresh BIP39 phrase into `newMnemonicDraft`. */
  onGenerateMnemonic: () => void;
  onWalletCreateSave: () => void;
  onWalletImportSave: () => void;
  onWalletUnlockSubmit: () => void;
}

/**
 * Inner content of the wallet unlock window (Create / Import / Unlock).
 * Extracted verbatim from `OsClient.tsx` (UI Polish Step 7). The surrounding
 * `Win95Window` (title, hideClose, badge, backdrop) stays in `OsClient.tsx`.
 */
export default function WalletUnlockBody({
  persistedWalletKind,
  walletUnlockErr,
  walletBusy,
  newMnemonicDraft,
  newWalletPin,
  setNewWalletPin,
  importMnemonicInput,
  setImportMnemonicInput,
  importWalletPin,
  setImportWalletPin,
  walletSecretInput,
  setWalletSecretInput,
  onGenerateMnemonic,
  onWalletCreateSave,
  onWalletImportSave,
  onWalletUnlockSubmit,
}: WalletUnlockBodyProps) {
  return (
    <>
      {walletUnlockErr ? (
        <div className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs font-mono text-red-900">
          {walletUnlockErr}
        </div>
      ) : null}
      {persistedWalletKind === "none" ? (
        <div className="space-y-3">
          <p className="text-xs text-black/80 leading-relaxed border-b border-black/10 pb-2">
            No wallet file on this device yet. Choose{" "}
            <strong className="text-black">Create</strong> for a new 12-word seed, or{" "}
            <strong className="text-black">Import</strong> if you already have a mnemonic. Set a{" "}
            <strong className="text-black">6–8 digit PIN</strong>; the mnemonic is encrypted with AES-GCM (PBKDF2)
            and stored only as{" "}
            <span className="font-mono">tet_wallet_keystore</span> — never as plaintext.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div
              className={`${inset} ${field} p-3 flex flex-col gap-2 border-2 border-t-white border-l-white border-b-[#a0a0a0] border-r-[#a0a0a0]`}
            >
              <div className="text-sm font-bold text-[#000080] border-b border-black/10 pb-1">
                Create New Wallet
              </div>
              <p className="text-[11px] text-black/70 leading-snug">
                Generates a fresh BIP39 phrase. Write it on paper before continuing — anyone with these words
                controls this identity.
              </p>
              <button
                type="button"
                disabled={walletBusy}
                className={`${winBtn} ${panel} px-2 py-1.5 text-xs font-semibold w-fit`}
                onClick={() => onGenerateMnemonic()}
              >
                Generate 12-word phrase
              </button>
              {newMnemonicDraft ? (
                <div className={`${outset} bg-[#fafaf6] p-2 font-mono text-[11px] break-words text-black max-h-28 overflow-y-auto`}>
                  {newMnemonicDraft}
                </div>
              ) : (
                <div className="text-[11px] text-black/40 italic">Phrase appears here after you generate.</div>
              )}
              <label className="block text-[11px] font-semibold text-black">
                PIN (6–8 digits)
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={newWalletPin}
                  onChange={(e) => setNewWalletPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  className={`${inset} mt-1 w-full bg-white px-2 py-1.5 font-mono text-sm`}
                  placeholder="e.g. 123456"
                />
              </label>
              <button
                type="button"
                disabled={walletBusy || newMnemonicDraft.trim().length === 0 || !isValidWalletPin(newWalletPin)}
                className={`${winBtn} ${panel} mt-auto w-full py-2.5 text-sm font-bold`}
                onClick={() => onWalletCreateSave()}
              >
                Save &amp; unlock
              </button>
            </div>
            <div
              className={`${inset} ${field} p-3 flex flex-col gap-2 border-2 border-t-white border-l-white border-b-[#a0a0a0] border-r-[#a0a0a0]`}
            >
              <div className="text-sm font-bold text-[#000080] border-b border-black/10 pb-1">
                Import Wallet (Mnemonic)
              </div>
              <p className="text-[11px] text-black/70 leading-snug">
                Paste your existing 12-word recovery phrase, then choose a new PIN to encrypt the copy stored on
                this device (you can reuse your old PIN if you prefer).
              </p>
              <label className="block text-[11px] font-semibold text-black">
                12-word mnemonic
                <textarea
                  value={importMnemonicInput}
                  onChange={(e) => setImportMnemonicInput(e.target.value)}
                  rows={5}
                  spellCheck={false}
                  className={`${inset} mt-1 w-full bg-white px-2 py-2 font-mono text-[12px] leading-relaxed resize-y min-h-[5.5rem]`}
                  placeholder="word1 word2 word3 … word12"
                />
              </label>
              <div className="text-[10px] text-black/50 font-mono">
                Words: {importMnemonicInput.trim() ? importMnemonicInput.trim().split(/\s+/).filter(Boolean).length : 0}{" "}
                / 12
              </div>
              <label className="block text-[11px] font-semibold text-black">
                PIN (6–8 digits, encrypts local copy)
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={importWalletPin}
                  onChange={(e) => setImportWalletPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  className={`${inset} mt-1 w-full bg-white px-2 py-1.5 font-mono text-sm`}
                  placeholder="e.g. 123456"
                />
              </label>
              <button
                type="button"
                disabled={
                  walletBusy ||
                  importMnemonicInput.trim().length === 0 ||
                  !isValidWalletPin(importWalletPin)
                }
                className={`${winBtn} ${panel} mt-auto w-full py-2.5 text-sm font-bold`}
                onClick={() => onWalletImportSave()}
              >
                Import &amp; unlock
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-black">Enter PIN to Unlock</p>
          <p className="text-xs text-black/75 leading-snug">
            {persistedWalletKind === "vault"
              ? "Enter the same master password you used on /setup (8+ characters, not only digits)."
              : persistedWalletKind === "legacy_plain"
                ? "This device has a legacy wallet — enter your PIN (6–8 digits). It will upgrade to AES-GCM storage."
                : "Encrypted wallet on this device — enter your 6–8 digit PIN. Keys stay in memory only after unlock."}
          </p>
          <input
            type="password"
            value={walletSecretInput}
            onChange={(e) => setWalletSecretInput(e.target.value)}
            className={`${inset} w-full ${field} px-2 py-1.5 font-mono text-sm`}
            placeholder={
              persistedWalletKind === "vault" ? "Master password" : "6–8 digit PIN"
            }
          />
          <button
            type="button"
            disabled={walletBusy || walletSecretInput.trim().length === 0}
            className={`${winBtn} ${panel} w-full py-2 text-sm font-semibold`}
            onClick={() => onWalletUnlockSubmit()}
          >
            {walletBusy ? "Unlocking…" : "Unlock"}
          </button>
        </div>
      )}
    </>
  );
}
