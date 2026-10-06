"use client";

/**
 * Try TET — one page on today's testnet (docs/DEMO_NODE.md), in the desktop's Win95 look. The
 * disposable wallet (part 0c) and the anonymous board (part 1); the other panels are placeholders that
 * already state their limits, and fill in with their parts.
 *
 * Talks only to this site's `/tet-node-api` proxy, which reaches a tet-core in public mode (an
 * allow-list of routes, rate-limited per visitor). The wallet is made and kept in this tab only.
 */
import { useEffect, useState } from "react";
import Win95Button from "../os/components/Win95Button";
import Win95Panel from "../os/components/Win95Panel";
import { generateDisposableWords, wordsFileText } from "../lib/disposable_wallet.mjs";
import { activateTryWallet, forgetTryWallet } from "../lib/try_session";
import BoardPanel from "./BoardPanel";
import VerifyPanel from "./VerifyPanel";

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
    <main className="min-h-screen bg-[#D6D4CE] font-mono text-sm text-black">
      <div className="bg-[#000080] px-2 py-1 text-sm font-bold text-white">Try TET — testnet</div>
      <div className="mx-auto max-w-5xl space-y-3 p-3">
        <Win95Panel variant="inset" className="bg-[#fff8e1] p-2 text-[13px]">
          Testnet. The demo node sees your IP address and when you make requests; it is run by one
          person. Nothing here is audited. The wallet you make lives in this tab.
        </Win95Panel>

        <div className="grid gap-3 sm:grid-cols-2">
          <Win95Panel title="Node" className="p-2">
            {node.state === "checking" ? <p>Checking the demo node…</p> : null}
            {node.state === "up" ? (
              <p>
                Connected · chain <code>{node.chainId}</code> · height {node.height ?? "?"}
              </p>
            ) : null}
            {node.state === "down" ? (
              <p className="text-[#8a1f1f]">The demo node isn&apos;t answering ({node.reason}).</p>
            ) : null}
          </Win95Panel>

          <Win95Panel title="Your disposable wallet" className="p-2">
            {!wallet ? (
              <>
                <p>Made in this tab from 12 random words. They are never sent anywhere, not even to the demo node.</p>
                <Win95Button className="mt-2 px-3 py-0.5 text-sm" onClick={() => void onCreate()}>
                  Create a wallet
                </Win95Button>
              </>
            ) : (
              <>
                <p>
                  Wallet id <code className="break-all">{wallet.walletId}</code>
                </p>
                <p className="mt-2">
                  {wallet.shown ? (
                    <code className="break-words">{wallet.words}</code>
                  ) : (
                    <Win95Button className="px-2 py-0.5 text-xs" onClick={() => setWallet({ ...wallet, shown: true })}>
                      Show the 12 words
                    </Win95Button>
                  )}
                </p>
                <p className="mt-2 flex gap-2">
                  <Win95Button className="px-2 py-0.5 text-xs" onClick={onDownload}>
                    Download the words
                  </Win95Button>
                  <Win95Button className="px-2 py-0.5 text-xs" variant="danger" onClick={onForget}>
                    Forget this wallet
                  </Win95Button>
                </p>
                <p className="mt-2 text-[12px] text-black/60">
                  Close this tab and the wallet is gone unless you saved the words. They open the same wallet in
                  the TET desktop.
                </p>
              </>
            )}
            {err ? <p className="mt-2 text-[#8a1f1f]">{err}</p> : null}
          </Win95Panel>
        </div>

        <BoardPanel baseUrl={BASE} walletId={wallet?.walletId ?? null} />

        <VerifyPanel baseUrl={BASE} />

        <div className="grid gap-3 sm:grid-cols-2">
          {PANELS.map((p) => (
            <Win95Panel key={p.title} title={p.title} className="p-2">
              <p>{p.what}</p>
              <p className="mt-2 text-black/50">Coming in part {p.part}.</p>
              <ul className="mt-2 list-disc pl-5 text-[11px] text-black/70">
                {p.limits.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Win95Panel>
          ))}
        </div>
      </div>
    </main>
  );
}
