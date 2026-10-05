"use client";

/**
 * Try TET — one page on today's testnet (docs/DEMO_NODE.md). Part 0c: the shell and the disposable
 * wallet. The panels are placeholders that already state their limits; each fills in with its part.
 *
 * Talks only to this site's `/tet-node-api` proxy, which reaches a tet-core in public mode (an
 * allow-list of routes, rate-limited per visitor). The wallet is made and kept in this tab only.
 */
import { useEffect, useState } from "react";
import { generateDisposableWords, wordsFileText } from "../lib/disposable_wallet.mjs";
import { activateTryWallet, forgetTryWallet } from "../lib/try_session";

const BASE = "/tet-node-api";

type NodeStatus =
  | { state: "checking" }
  | { state: "up"; height: number | null; chainId: string }
  | { state: "down"; reason: string };

type Wallet = { words: string; walletId: string; shown: boolean };

const PANELS: { title: string; part: number; what: string; limits: string[] }[] = [
  {
    title: "Tmail",
    part: 2,
    what: "End-to-end encrypted messages between keys.",
    limits: [
      "Key exchange is Kyber round 3, not the final ML-KEM standard.",
      "Burn-after-read is best-effort; scheduled release is withheld by nodes, not enforced.",
      "A conversation keeps its newest 5 messages.",
    ],
  },
  {
    title: "Files",
    part: 3,
    what: "Send a file, encrypted, peer to peer; the fee is sponsored for the demo.",
    limits: [
      "The demo sponsors a few file fees per visitor per day; past that the file still arrives.",
      "Files are stored on the demo node with a size cap and an expiry.",
    ],
  },
  {
    title: "Anonymous board",
    part: 1,
    what: "Post to a board with a zero-knowledge proof that you're a member, not who you are.",
    limits: [
      "Anonymous posting needs the native prover on your own computer; without it, posts are named.",
      "You're anonymous only among registered members, a handful today.",
      "The demo node sees your IP address and timing.",
    ],
  },
  {
    title: "Verify anything",
    part: 4,
    what: "Drop a file or text and its .sig.json; see who signed it.",
    limits: [
      "A valid signature proves which key signed, not who holds it, unless a manifest or pin says so.",
      "It can't prove when something was written.",
    ],
  },
  {
    title: "AI asks a human",
    part: 5,
    what: "Questions posted by an agent's key; answer them, anonymously if you have the prover.",
    limits: ["No payment yet: answering earns nothing.", "An agent's owner is only as trustworthy as its manifest."],
  },
];

export default function TryPage() {
  const [node, setNode] = useState<NodeStatus>({ state: "checking" });
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [st, ch] = await Promise.all([fetch(`${BASE}/ledger/state`), fetch(`${BASE}/chain`)]);
        if (!st.ok || !ch.ok) throw new Error(`HTTP ${st.status}/${ch.status}`);
        const s = await st.json();
        const c = await ch.json();
        if (!cancelled) {
          setNode({ state: "up", height: s.block_height ?? null, chainId: String(c.chain_id ?? "") });
        }
      } catch (e: unknown) {
        if (!cancelled) setNode({ state: "down", reason: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreate() {
    setErr("");
    try {
      const words = generateDisposableWords();
      const walletId = await activateTryWallet(words);
      setWallet({ words, walletId, shown: false });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function onDownload() {
    if (!wallet) return;
    const blob = new Blob([wordsFileText(wallet.words, wallet.walletId)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tet-testnet-wallet-${wallet.walletId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onForget() {
    forgetTryWallet();
    setWallet(null);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 text-sm text-black">
      <h1 className="text-2xl font-semibold">Try TET</h1>
      <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-[13px]">
        Testnet. The demo node sees your IP address and when you make requests; it is run by one
        person. Nothing here is audited. The wallet you make lives in this tab.
      </p>

      <section className="mt-6 rounded border p-4">
        <h2 className="font-semibold">Node</h2>
        {node.state === "checking" ? <p>Checking the demo node…</p> : null}
        {node.state === "up" ? (
          <p>
            Connected · chain <code>{node.chainId}</code> · height {node.height ?? "?"}
          </p>
        ) : null}
        {node.state === "down" ? <p className="text-red-700">The demo node isn&apos;t answering ({node.reason}).</p> : null}
      </section>

      <section className="mt-4 rounded border p-4">
        <h2 className="font-semibold">Your disposable wallet</h2>
        {!wallet ? (
          <>
            <p className="mt-1">
              Made in this tab from 12 random words. They are never sent anywhere, not even to the demo node.
            </p>
            <button type="button" onClick={() => void onCreate()} className="mt-2 rounded border px-3 py-1">
              Create a wallet
            </button>
          </>
        ) : (
          <>
            <p className="mt-1">
              Wallet id <code className="break-all">{wallet.walletId}</code>
            </p>
            <p className="mt-2">
              {wallet.shown ? (
                <code className="break-words">{wallet.words}</code>
              ) : (
                <button type="button" onClick={() => setWallet({ ...wallet, shown: true })} className="rounded border px-2 py-0.5">
                  Show the 12 words
                </button>
              )}
            </p>
            <p className="mt-2 flex gap-2">
              <button type="button" onClick={onDownload} className="rounded border px-2 py-0.5">
                Download the words
              </button>
              <button type="button" onClick={onForget} className="rounded border px-2 py-0.5">
                Forget this wallet
              </button>
            </p>
            <p className="mt-2 text-black/60">
              Close this tab and the wallet is gone unless you saved the words. They open the same wallet in
              the TET desktop.
            </p>
          </>
        )}
        {err ? <p className="mt-2 text-red-700">{err}</p> : null}
      </section>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {PANELS.map((p) => (
          <section key={p.title} className="rounded border p-4">
            <h2 className="font-semibold">{p.title}</h2>
            <p className="mt-1">{p.what}</p>
            <p className="mt-2 text-black/50">Coming in part {p.part}.</p>
            <ul className="mt-2 list-disc pl-5 text-[12px] text-black/70">
              {p.limits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
