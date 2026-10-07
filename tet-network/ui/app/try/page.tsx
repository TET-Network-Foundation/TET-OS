"use client";

/**
 * Try TET: one page on today's testnet (docs/DEMO_NODE.md). The modern entrance; the desktop at /os
 * keeps the Win95 look. Mobile-first: one panel at a time, one obvious action each. The anonymous
 * board (part 1), Tmail and Files (parts 2, 3), verify anything (part 4), AI asks a human (part 5).
 * Every panel opens with its limits as the pinned post `0`.
 *
 * Talks only to this site's `/tet-node-api` proxy, which reaches a tet-core in public mode (an
 * allow-list of routes, rate-limited per visitor). A panel loads only when first opened, so a first
 * visit stays inside the read burst. The wallet (part 0c) is made on the first action that needs
 * it and kept in this tab only.
 */
import { useEffect, useState } from "react";
import { wordsFileText } from "../lib/disposable_wallet.mjs";
import BoardPanel from "./BoardPanel";
import FilesTryPanel from "./FilesTryPanel";
import QuestionsPanel from "./QuestionsPanel";
import TmailPanel from "./TmailPanel";
import VerifyPanel from "./VerifyPanel";
import { Button, FOCUS, INK, cx } from "./ui";
import { BASE, WalletProvider, useTryWallet } from "./wallet";

/** A wallet the operator reads (deploy/demo/README.md, "message the demo"); empty when not set. */
const DEMO_CONTACT = /^[0-9a-f]{64}$/.test((process.env.NEXT_PUBLIC_TET_DEMO_CONTACT ?? "").trim().toLowerCase())
  ? (process.env.NEXT_PUBLIC_TET_DEMO_CONTACT ?? "").trim().toLowerCase()
  : "";

const TABS = [
  { id: "board", label: "Board" },
  { id: "verify", label: "Verify" },
  { id: "tmail", label: "Tmail" },
  { id: "files", label: "Files" },
  { id: "ask", label: "AI asks" },
] as const;
type TabId = (typeof TABS)[number]["id"];

type NodeStatus = { state: "checking" } | { state: "up"; height: number | null; chainId: string } | { state: "down"; reason: string };

function WalletBar() {
  const { wallet, forget } = useTryWallet();
  const [shown, setShown] = useState(false);
  // Forgetting can't be undone unless the words were saved: the first tap asks, the second forgets.
  const [confirmForget, setConfirmForget] = useState(false);
  useEffect(() => {
    if (!confirmForget) return;
    const t = setTimeout(() => setConfirmForget(false), 5_000);
    return () => clearTimeout(t);
  }, [confirmForget]);
  if (!wallet) return null;
  function onDownload() {
    if (!wallet) return;
    const url = URL.createObjectURL(new Blob([wordsFileText(wallet.words, wallet.walletId)], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tet-testnet-wallet-${wallet.walletId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 text-[15px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Wallet <span translate="no" className={cx("font-mono", INK.named)}>{wallet.walletId.slice(0, 8)}</span>
        </span>
        <Button kind="quiet" onClick={() => setShown(!shown)}>
          {shown ? "hide words" : "12 words"}
        </Button>
        <Button kind="quiet" onClick={onDownload}>
          save
        </Button>
        <Button
          kind="quiet"
          onClick={() => {
            if (!confirmForget) return setConfirmForget(true);
            setConfirmForget(false);
            forget();
          }}
        >
          {confirmForget ? <span className={INK.bad}>tap again to forget this wallet</span> : "forget"}
        </Button>
      </div>
      {shown ? (
        <p translate="no" className="mt-1 break-words font-mono text-[15px]">
          {wallet.words}
        </p>
      ) : null}
      <p className="mt-1 text-[14px] text-neutral-500">Made in this tab, never sent anywhere. Close the tab without saving the words and it is gone.</p>
    </div>
  );
}

function TryApp() {
  const [node, setNode] = useState<NodeStatus>({ state: "checking" });
  const [tab, setTab] = useState<TabId>("board");
  const [opened, setOpened] = useState<Set<TabId>>(() => new Set<TabId>(["board"]));

  // The open panel lives in `?tab=` (the board invite stays in the `#`, which never reaches a server).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    const found = TABS.find((x) => x.id === t);
    if (!found || found.id === "board") return;
    const t0 = setTimeout(() => {
      setTab(found.id);
      setOpened((o) => new Set(o).add(found.id));
    }, 0);
    return () => clearTimeout(t0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [st, ch] = await Promise.all([fetch(`${BASE}/ledger/state`), fetch(`${BASE}/chain`)]);
        if (!st.ok || !ch.ok) throw new Error(`HTTP ${st.status}/${ch.status}`);
        const s = await st.json();
        const c = await ch.json();
        if (!cancelled) setNode({ state: "up", height: s.block_height ?? null, chainId: String(c.chain_id ?? "") });
      } catch (e: unknown) {
        if (!cancelled) setNode({ state: "down", reason: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function show(id: TabId) {
    setTab(id);
    const url = new URL(window.location.href);
    if (id === "board") url.searchParams.delete("tab");
    else url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
    setOpened((o) => (o.has(id) ? o : new Set(o).add(id)));
    window.scrollTo({ top: 0 });
  }

  // Once opened, a panel stays mounted (hidden), so switching back keeps its state.
  const panel = (id: TabId, node: React.ReactNode) => (opened.has(id) ? <div className={cx(tab !== id && "hidden")}>{node}</div> : null);

  return (
    <main className="min-h-screen touch-manipulation bg-[#f6f6f4] text-base text-neutral-900 [-webkit-tap-highlight-color:transparent] [font-family:ui-sans-serif,system-ui,-apple-system,'Segoe_UI',Roboto,sans-serif]">
      <a href="#panel" className={cx(FOCUS, "sr-only rounded bg-white px-3 py-2 focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-20")}>
        Skip to the panel
      </a>
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-[#f6f6f4]/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-baseline gap-2 px-4 pt-3">
          <h1 className="text-lg font-bold">Try TET</h1>
          <span className="text-[14px] text-neutral-500">testnet</span>
          <span className="ml-auto truncate text-[13px] text-neutral-500">
            {node.state === "checking" ? "node: checking…" : null}
            {node.state === "up" ? <span className="tabular-nums">height {node.height ?? "?"}</span> : null}
            {node.state === "down" ? <span className={INK.bad}>node not answering</span> : null}
          </span>
        </div>
        <nav className="mx-auto flex max-w-2xl gap-1 overflow-x-auto px-4 py-2" aria-label="Panels">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => show(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={cx(
                FOCUS,
                "min-h-9 shrink-0 rounded-full px-3 text-[15px] font-medium",
                tab === t.id ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-200",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <div id="panel" className="mx-auto max-w-2xl scroll-mt-28 space-y-3 px-4 py-3">
        <p className="text-[14px] leading-relaxed text-neutral-600">
          Testnet. The demo node sees your IP address and when you make requests; it is run by one person. Nothing here is audited.
        </p>
        <WalletBar />
        {panel("board", <BoardPanel />)}
        {panel("verify", <VerifyPanel baseUrl={BASE} />)}
        {panel("tmail", <TmailPanel demoContact={DEMO_CONTACT} />)}
        {panel("files", <FilesTryPanel demoContact={DEMO_CONTACT} />)}
        {panel("ask", <QuestionsPanel />)}
      </div>
    </main>
  );
}

export default function TryPage() {
  return (
    <WalletProvider>
      <TryApp />
    </WalletProvider>
  );
}
