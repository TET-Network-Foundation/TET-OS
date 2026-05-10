"use client";

import { useMemo, useState } from "react";
import {
  createInAppWalletWithMnemonic,
  generateMnemonic12Polkadot,
  inAppWalletExists,
  isValidWalletPin,
} from "../lib/inapp_wallet";

type Step = "start" | "seeds" | "pin" | "success";

export default function CreateWalletPage() {
  const [step, setStep] = useState<Step>("start");
  const [mnemonic12, setMnemonic12] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  const words = useMemo(() => mnemonic12.trim().split(/\s+/).filter(Boolean).slice(0, 12), [mnemonic12]);

  const onGenerate = async () => {
    setErr("");
    try {
      const m = await generateMnemonic12Polkadot();
      setMnemonic12(m);
      setStep("seeds");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr((msg || "Failed to generate seeds").toString());
    }
  };

  const onEncrypt = async () => {
    setErr("");
    try {
      await createInAppWalletWithMnemonic(pin, mnemonic12);
      setStep("success");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr((msg || "Failed to encrypt wallet").toString());
    }
  };

  return (
    <main className="max-w-3xl mx-auto px-6 py-16 bg-white text-black">
      <header className="mb-10">
        <div className="text-xs tracking-widest uppercase text-gray-500 mb-3">Create Wallet</div>
        <h1 className="text-4xl font-extrabold tracking-tight mb-2">High-stakes In-App Wallet</h1>
        <p className="text-gray-600">
          Step-by-step generation. PIN-locked encryption. Stored locally.
        </p>
      </header>

      {err ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {err}
        </div>
      ) : null}

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div className="text-sm font-semibold text-black">Flow</div>
          <div className="text-xs text-gray-500">
            {inAppWalletExists() ? "Wallet exists on this device" : "No wallet saved on this device"}
          </div>
        </div>

        {step === "start" ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 font-mono text-xs text-gray-700">
              [Generate Seeds] → [Set PIN 6–8 digits] → [Success]
            </div>
            <button
              type="button"
              onClick={onGenerate}
              className="w-full rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white hover:bg-gray-900"
            >
              Generate Seeds
            </button>
          </div>
        ) : null}

        {step === "seeds" ? (
          <div>
            <div className="text-sm font-semibold mb-2">Recovery Phrase (12 words)</div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="grid grid-cols-3 gap-2">
                {words.map((w, idx) => (
                  <div key={`${w}-${idx}`} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                    <div className="text-[10px] font-semibold text-gray-500">{idx + 1}</div>
                    <div className="mt-0.5 text-sm font-mono text-gray-900">{w}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setStep("pin")}
                className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-900"
              >
                Set PIN
              </button>
            </div>
          </div>
        ) : null}

        {step === "pin" ? (
          <div>
            <div className="text-sm font-semibold mb-2">Set PIN (6–8 digits)</div>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              pattern="[0-9]*"
              type="password"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 font-mono text-sm outline-none focus:border-gray-400"
              placeholder="6–8 digits"
            />
            <div className="mt-2 text-xs text-gray-600">
              Your mnemonic is encrypted with your PIN and saved to localStorage. Never store it anywhere else.
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setStep("seeds")}
                className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onEncrypt}
                disabled={!isValidWalletPin(pin)}
                className="rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-900 disabled:opacity-40"
              >
                Encrypt & Save
              </button>
            </div>
          </div>
        ) : null}

        {step === "success" ? (
          <div className="space-y-3">
            <div className="text-sm font-semibold text-black">Success</div>
            <div className="text-sm text-gray-700">
              Your in-app wallet is encrypted and saved on this device.
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

