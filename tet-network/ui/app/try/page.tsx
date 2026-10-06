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
import VerifyPanel from "./VerifyPanel";
import QuestionsPanel from "./QuestionsPanel";

const BASE = "/tet-node-api";

/** A wallet the operator reads (deploy/demo/README.md, "message the demo"); empty when not set. */
const DEMO_CONTACT = /^[0-9a-f]{64}$/.test((process.env.NEXT_PUBLIC_TET_DEMO_CONTACT ?? "").trim().toLowerCase())
  ? (process.env.NEXT_PUBLIC_TET_DEMO_CONTACT ?? "").trim().toLowerCase()
  : "";

const TMAIL_LIMITS = [
  "Key exchange is Kyber round 3, not the final ML-KEM standard (FIPS 203).",
  "Burn-after-read is best-effort: cooperating nodes delete the message; others may keep the ciphertext.",
  "Scheduled release is the nodes withholding a message, not cryptographic enforcement.",
  "A conversation keeps only its newest 5 messages, and messages expire after 7 days.",
  "Contents are end-to-end encrypted; the demo node still sees which wallets write to which, and when.",
  "To receive, register your messaging keys (the button below). Registering is public.",
];

const FILES_LIMITS = [
  "Files are encrypted in this tab and stored on the demo node: at most 5 MB, kept 30 days.",
  "The 1,000 µTET fee is paid by the demo's sponsor, for up to 5 files per connection and per wallet a day. Past that, or if the sponsor is low, the file still arrives and its fee shows as unpaid.",
  "The node a file is stored on is only a hint: fetching asks the peers this node is connected to.",
  "The demo node sees sender, recipient, size and time; not the contents or the file name.",
];

function Limits(props: { items: string[] }) {
  return (
    <ul className="mt-2 list-disc pl-5 text-[11px] text-black/70">
      {props.items.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

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

        <Win95Panel title="Tmail" className="p-2">
          {wallet ? (
            <MessagesPanel
              key={wallet.walletId}
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
            <p>Create a disposable wallet above to send and receive end-to-end encrypted messages.</p>
          )}
          {!DEMO_CONTACT ? (
            <p className="mt-1 text-[12px] text-black/60">
              No demo inbox on this node: message yourself, or open this page in a second tab with another wallet.
            </p>
          ) : null}
          <Limits items={TMAIL_LIMITS} />
        </Win95Panel>

        <Win95Panel title="Files" className="p-2">
          {wallet ? (
            <FilesPanel
              key={wallet.walletId}
              baseUrl={BASE}
              myWalletId={wallet.walletId}
              feeMode="demo-sponsor"
              contacts={[
                ...(DEMO_CONTACT ? [{ label: "The demo", address: DEMO_CONTACT }] : []),
                { label: "Yourself", address: wallet.walletId },
              ]}
            />
          ) : (
            <p>Create a disposable wallet above to send and receive encrypted files.</p>
          )}
          <Limits items={FILES_LIMITS} />
        </Win95Panel>

        <BoardPanel baseUrl={BASE} walletId={wallet?.walletId ?? null} />

        <VerifyPanel baseUrl={BASE} />

        <QuestionsPanel baseUrl={BASE} walletId={wallet?.walletId ?? null} />

      </div>
    </main>
  );
}
