"use client";

/**
 * Try TET — one page on today's testnet (docs/DEMO_NODE.md), in the desktop's Win95 look. The
 * disposable wallet (part 0c), Tmail and Files (parts 2, 3), the anonymous board (part 1) and verify
 * anything (part 4) and AI asks a human (part 5). Every panel prints its limits.
 *
 * Talks only to this site's `/tet-node-api` proxy, which reaches a tet-core in public mode (an
 * allow-list of routes, rate-limited per visitor). The wallet is made and kept in this tab only.
 */
import { useEffect, useState } from "react";
import MessagesPanel from "../os/MessagesPanel";
import FilesPanel from "../os/tabs/FilesPanel";
import Win95Button from "../os/components/Win95Button";
import Win95Panel from "../os/components/Win95Panel";
import { bevel, buttonBevel } from "../os/components/tokens";
import { generateDisposableWords, wordsFileText } from "../lib/disposable_wallet.mjs";
import { activateTryWallet, forgetTryWallet } from "../lib/try_session";
import BoardPanel from "./BoardPanel";
import Notice, { Hint } from "./Notice";
import VerifyPanel from "./VerifyPanel";
import QuestionsPanel from "./QuestionsPanel";

const BASE = "/tet-node-api";

/** A wallet the operator reads (deploy/demo/README.md, "message the demo"); empty when not set. */
const DEMO_CONTACT = /^[0-9a-f]{64}$/.test((process.env.NEXT_PUBLIC_TET_DEMO_CONTACT ?? "").trim().toLowerCase())
  ? (process.env.NEXT_PUBLIC_TET_DEMO_CONTACT ?? "").trim().toLowerCase()
  : "";

const TMAIL_LIMITS = [
  "Key exchange is Kyber round 3, not the final ML-KEM standard (FIPS 203).",
  "Burn-after-read is best-effort: cooperating nodes delete; others may keep the ciphertext.",
  "Scheduled release is nodes withholding a message, not cryptographic enforcement.",
  "A conversation keeps its newest 5 messages; messages expire after 7 days.",
  "Contents are end-to-end encrypted; the node still sees who writes to whom, and when.",
  "Registering your keys is public.",
];

const FILES_LIMITS = [
  "Encrypted in this tab, stored on the demo node: at most 5 MB, kept 30 days.",
  "The 1,000 µTET fee is paid by the demo's sponsor, up to 5 files per connection and per wallet a day. Past that, the file still arrives and its fee shows as unpaid.",
  "The storage node is only a hint: fetching asks this node's peers.",
  "The node sees sender, recipient, size and time; not the contents or the file name.",
];

type NodeStatus =
  | { state: "checking" }
  | { state: "up"; height: number | null; chainId: string }
  | { state: "down"; reason: string };

type Wallet = { words: string; walletId: string; shown: boolean };


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
    <main className="min-h-screen bg-[#D6D4CE] text-sm text-black">
      <div className="bg-[#000080] px-2 py-1 font-mono text-sm font-bold text-white">Try TET — testnet</div>
      <div className="mx-auto max-w-5xl space-y-3 p-3">
        <Win95Panel variant="inset" className="bg-[#fff8e1] p-2 font-mono text-[12px]">
          Testnet. The demo node sees your IP address and when you make requests; it is run by one
          person. Nothing here is audited. The wallet you make lives in this tab.
        </Win95Panel>

        <Win95Panel title="Your disposable wallet" className="p-2 font-mono text-[12px]">
          <div className="flex flex-wrap items-center gap-2">
            {!wallet ? (
              <>
                <Win95Button variant="primary" className="px-3 py-0.5 text-sm" onClick={() => void onCreate()}>
                  Create a wallet
                </Win95Button>
                <span className="text-black/70">12 random words, made in this tab and never sent anywhere. Every panel below needs it.</span>
              </>
            ) : (
              <>
                <span>
                  wallet <code className="break-all">{wallet.walletId}</code>
                </span>
                <Win95Button className="px-2 py-0 text-[11px]" onClick={() => setWallet({ ...wallet, shown: !wallet.shown })}>
                  {wallet.shown ? "Hide the words" : "Show the 12 words"}
                </Win95Button>
                <Win95Button className="px-2 py-0 text-[11px]" onClick={onDownload}>
                  Download the words
                </Win95Button>
                <Win95Button className="px-2 py-0 text-[11px]" variant="danger" onClick={onForget}>
                  Forget
                </Win95Button>
              </>
            )}
            <span className="ml-auto text-black/60">
              {node.state === "checking" ? "node: checking…" : null}
              {node.state === "up" ? `node: ${node.chainId} · height ${node.height ?? "?"}` : null}
              {node.state === "down" ? <span className="text-[#8a1f1f]">node not answering ({node.reason})</span> : null}
            </span>
          </div>
          {wallet?.shown ? <p className="mt-1 break-words">{wallet.words}</p> : null}
          {wallet ? (
            <p className="mt-1 text-[11px] text-black/60">
              Close this tab and the wallet is gone unless you saved the words. They open the same wallet in the TET desktop.
            </p>
          ) : null}
          {err ? <p className="mt-1 text-[#8a1f1f]">{err}</p> : null}
        </Win95Panel>

        <BoardPanel baseUrl={BASE} walletId={wallet?.walletId ?? null} />

        <VerifyPanel baseUrl={BASE} />

        <Win95Panel title="Tmail" className="p-2">
          <Notice items={TMAIL_LIMITS} />
          <div className="mt-2">
            <Hint>
              Register your keys (1), then pick a recipient, write, and send.
              {!DEMO_CONTACT ? " This node has no demo inbox: message yourself, or a second tab." : ""}
            </Hint>
            {wallet ? (
              <MessagesPanel
                key={wallet.walletId}
                compact
                outset={bevel.outset}
                inset={bevel.inset}
                winBtn={buttonBevel}
                baseUrl={BASE}
                myWalletId={wallet.walletId}
                quickRecipients={[
                  ...(DEMO_CONTACT ? [{ label: "Message the demo", walletId: DEMO_CONTACT }] : []),
                  { label: "Message yourself", walletId: wallet.walletId },
                ]}
              />
            ) : (
              <p className="font-mono text-[12px] text-black/60">Create a wallet first (top of the page).</p>
            )}
          </div>
        </Win95Panel>

        <Win95Panel title="Files" className="p-2">
          <Notice items={FILES_LIMITS} />
          <div className="mt-2">
            <Hint>Register your keys (1), drop a file, pick a recipient, and send. The fee is the demo&apos;s.</Hint>
            {wallet ? (
              <FilesPanel
                key={wallet.walletId}
                compact
                baseUrl={BASE}
                myWalletId={wallet.walletId}
                feeMode="demo-sponsor"
                contacts={[
                  ...(DEMO_CONTACT ? [{ label: "The demo", address: DEMO_CONTACT }] : []),
                  { label: "Yourself", address: wallet.walletId },
                ]}
              />
            ) : (
              <p className="font-mono text-[12px] text-black/60">Create a wallet first (top of the page).</p>
            )}
          </div>
        </Win95Panel>

        <QuestionsPanel baseUrl={BASE} walletId={wallet?.walletId ?? null} />
      </div>
    </main>
  );
}
