"use client";

import { useMemo, useState } from "react";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { Keyring } from "@polkadot/keyring";

import {
  createInAppWalletWithMnemonic,
  generateMnemonic12Polkadot,
  inAppWalletExists,
  unlockInAppWallet,
} from "../lib/inapp_wallet";

function shortAddr(addr: string, head = 6, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function isPin8(s: string): boolean {
  return /^\d{8}$/.test((s ?? "").trim());
}

function Modal(props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/40" onClick={props.onClose} aria-hidden="true" />
      <div className="absolute inset-0 grid place-items-center p-4">
        <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4">
            <div className="text-sm font-semibold text-gray-900">{props.title}</div>
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
          <div className="px-5 py-4">{props.children}</div>
        </div>
      </div>
    </div>
  );
}

export default function WalletControls(props: {
  connectedAddress: string;
  onConnectedAddress: (addr: string) => void;
  onError: (msg: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [mnemonic12, setMnemonic12] = useState<string>("");
  const [createPin, setCreatePin] = useState<string>("");
  const [loginPin, setLoginPin] = useState<string>("");
  const [loginInlineError, setLoginInlineError] = useState<string>("");

  const words = useMemo(() => mnemonic12.trim().split(/\s+/).filter(Boolean).slice(0, 12), [mnemonic12]);

  const onCreateWallet = async () => {
    props.onError("");
    try {
      const m = await generateMnemonic12Polkadot();
      setMnemonic12(m);
      setCreatePin("");
      setCreateOpen(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      props.onError((msg || "Failed to generate mnemonic").toString());
    }
  };

  const onSaveCreatedWallet = async () => {
    props.onError("");
    try {
      await createInAppWalletWithMnemonic(createPin, mnemonic12);
      await cryptoWaitReady();
      const kr = new Keyring({ type: "sr25519" });
      const pair = kr.addFromMnemonic(mnemonic12);
      props.onConnectedAddress(pair.address);

      setCreateOpen(false);
      setMnemonic12("");
      setCreatePin("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      props.onError((msg || "Failed to create wallet").toString());
    }
  };

  const onOpenLogin = () => {
    props.onError("");
    setLoginInlineError("");
    setLoginPin("");
    setLoginOpen(true);
  };

  const onLoginWithPin = async () => {
    props.onError("");
    setLoginInlineError("");
    try {
      if (!inAppWalletExists()) {
        setLoginInlineError("No wallet found. Please create one.");
        return;
      }
      const { mnemonic12: m } = await unlockInAppWallet(loginPin);
      await cryptoWaitReady();
      const kr = new Keyring({ type: "sr25519" });
      const pair = kr.addFromMnemonic(m);
      props.onConnectedAddress(pair.address);
      setLoginOpen(false);
      setLoginPin("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoginInlineError((msg || "Invalid PIN").toString());
    }
  };

  const onLogout = () => {
    props.onConnectedAddress("");
    props.onError("");
  };

  return (
    <>
      {props.connectedAddress ? (
        <button
          type="button"
          onClick={onLogout}
          className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black"
          title="Click to log out"
        >
          {`Connected: ${shortAddr(props.connectedAddress)}`}
        </button>
      ) : (
        <>
          <button
            type="button"
            onClick={onCreateWallet}
            className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black"
          >
            Create Wallet
          </button>
          <button
            type="button"
            onClick={onOpenLogin}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Connect Wallet
          </button>
        </>
      )}

      <Modal open={createOpen} title="Create In‑App Wallet" onClose={() => setCreateOpen(false)}>
        <div className="text-sm text-gray-700">
          Save these 12 words. They are your wallet. Your PIN only encrypts them on this device.
        </div>
        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="text-[11px] tracking-[0.14em] uppercase text-gray-500">Recovery Phrase (12 words)</div>
          {words.length ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {words.map((w, idx) => (
                <div key={`${w}-${idx}`} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                  <div className="text-[10px] font-semibold text-gray-500">{idx + 1}</div>
                  <div className="mt-0.5 text-sm font-mono text-gray-900">{w}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 text-sm text-gray-700">Generating…</div>
          )}
        </div>
        <div className="mt-4">
          <label className="block text-xs font-semibold text-gray-700">Set PIN (8 digits)</label>
          <input
            value={createPin}
            onChange={(e) => setCreatePin(e.target.value)}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
            placeholder="••••••••"
          />
          <div className="mt-2 text-xs text-gray-500">
            The raw mnemonic is never stored in localStorage. Only the encrypted ciphertext is saved.
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setCreateOpen(false)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSaveCreatedWallet}
            disabled={!mnemonic12 || !isPin8(createPin)}
            className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-40"
          >
            Encrypt & Save
          </button>
        </div>
      </Modal>

      <Modal open={loginOpen} title="Connect Wallet (PIN Login)" onClose={() => setLoginOpen(false)}>
        <div className="text-sm text-gray-700">Enter your 8-digit PIN to unlock your in-app wallet.</div>
        <div className="mt-4">
          <label className="block text-xs font-semibold text-gray-700">PIN (8 digits)</label>
          <input
            value={loginPin}
            onChange={(e) => setLoginPin(e.target.value)}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400"
            placeholder="••••••••"
          />
          {loginInlineError ? <div className="mt-2 text-sm text-rose-700">{loginInlineError}</div> : null}
          <button
            type="button"
            onClick={() => {
              setLoginInlineError("");
              setLoginOpen(false);
              void onCreateWallet();
            }}
            className="mt-3 text-xs font-semibold text-gray-700 underline decoration-gray-300 underline-offset-4 hover:decoration-gray-500"
          >
            Don&apos;t have a wallet? Create New Wallet
          </button>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setLoginOpen(false)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onLoginWithPin}
            disabled={!isPin8(loginPin)}
            className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-40"
          >
            Unlock
          </button>
        </div>
      </Modal>
    </>
  );
}

