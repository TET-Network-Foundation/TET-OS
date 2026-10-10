"use client";

/**
 * Try TET: one page on today's testnet (docs/DEMO_NODE.md). Design pass 2, "Ledger": a three-column
 * shell. Left, the channels: boards opened in this tab, the questions board, and the tools (verify,
 * files, mail). Middle, the selected one. Right (wide screens only), node facts for engineers. On a
 * phone the sidebar folds into a top bar with one switcher. The desktop at /os keeps Win95.
 *
 * Talks only to this site's `/tet-node-api` proxy (a tet-core in public mode: an allow-list of
 * routes, rate-limited per visitor). A panel loads only when first opened. Board invites live after
 * the `#` (never sent to a server); the open tool is in `?tab=`.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { wordsFileText } from "../lib/disposable_wallet.mjs";
import { openBoard, readDirectory, type OpenBoard } from "../lib/try_board";
import DirectoryPanel from "./DirectoryPanel";
import AboutPanel from "./AboutPanel";
import { IdCard } from "./IdCard";
import TermsPanel from "./TermsPanel";
import LivePanel from "./LivePanel";
import SignPanel from "./SignPanel";
import HomePanel from "./HomePanel";
import HowPanel from "./HowPanel";
import { getUi, setUi } from "../lib/device_store";
import QrPanel from "./QrPanel";
import BoardPanel from "./BoardPanel";
import FilesTryPanel from "./FilesTryPanel";
import MailPanel from "./MailPanel";
import NewBoardPanel from "./NewBoardPanel";
import QuestionsPanel from "./QuestionsPanel";
import VerifyPanel from "./VerifyPanel";
import { Button, FOCUS, INK, MONO, cx } from "./ui";
import { BASE, WalletProvider, useTryWallet } from "./wallet";
import { LangProvider, LangSwitch, useLang } from "./i18n";
import LiveStrip from "./LiveStrip";
import SitePanel from "./SitePanel";
import WhatPanel from "./WhatPanel";
import InsidePanel from "./InsidePanel";
import GenuinePanel from "./GenuinePanel";
import SealPanel from "./SealPanel";
import ShelterPanel from "./ShelterPanel";
import { shelterOpen } from "../lib/shelter";
import { formatTet } from "../lib/format_tet";

/** A wallet the operator reads (deploy/demo/README.md, "message the demo"); empty when not set. */
const DEMO_CONTACT = /^[0-9a-f]{64}$/.test((process.env.NEXT_PUBLIC_TET_DEMO_CONTACT ?? "").trim().toLowerCase())
  ? (process.env.NEXT_PUBLIC_TET_DEMO_CONTACT ?? "").trim().toLowerCase()
  : "";
/** The commit this UI was built from, when the build passes it in. */
const BUILD_SHA = /^[0-9a-f]{7,40}$/.test(process.env.NEXT_PUBLIC_TET_BUILD_SHA ?? "") ? (process.env.NEXT_PUBLIC_TET_BUILD_SHA as string) : "";
const REPO = "https://github.com/TET-Network-Foundation/TET-OS";
/** The node's public-board directory (deploy/demo/README.md §9): a board whose invite is public. */
const DIRECTORY_INVITE = (process.env.NEXT_PUBLIC_TET_DIRECTORY_INVITE ?? "").trim();

const TOOLS = [
  { id: "directory", label: "Public boards", group: "boards" },
  { id: "questions", label: "Questions for humans", group: "boards" },
  { id: "shelter", label: "Shelter", group: "boards" },
  { id: "verify", label: "verify", group: "tools" },
  { id: "sign", label: "sign", group: "tools" },
  { id: "genuine", label: "mark as genuine", group: "tools" },
  { id: "seal", label: "sealed prediction", group: "tools" },
  { id: "qr", label: "qr", group: "tools" },
  { id: "files", label: "files", group: "tools" },
  { id: "site", label: "site", group: "tools" },
  { id: "mail", label: "DM", group: "tools" },
  { id: "live", label: "live", group: "tools" },
  { id: "about", label: "About", group: "footer" },
  { id: "terms", label: "Terms", group: "footer" },
] as const;
type ToolId = (typeof TOOLS)[number]["id"] | "new" | "home" | "how" | "what" | "inside";
/** What the middle column shows: a board (by invite) or a tool. */
type View = { board: string } | { tool: ToolId };
const viewKey = (v: View) => ("board" in v ? `b:${v.board}` : `t:${v.tool}`);

type Chain = { chainId: string; genesis: string } | null;

function useNode() {
  const [chain, setChain] = useState<Chain>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [down, setDown] = useState("");
  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const st = await fetch(`${BASE}/ledger/state`);
        if (!st.ok) throw new Error(`HTTP ${st.status}`);
        const s = await st.json();
        if (live) {
          setHeight(typeof s.block_height === "number" ? s.block_height : null);
          setDown("");
        }
      } catch (e: unknown) {
        if (live) setDown(e instanceof Error ? e.message : String(e));
      }
    };
    void (async () => {
      try {
        const c = await (await fetch(`${BASE}/chain`)).json();
        if (live) setChain({ chainId: String(c.chain_id ?? ""), genesis: String(c.genesis_hash ?? "") });
      } catch {
        /* the height poll reports the node as down */
      }
    })();
    void poll();
    const t = setInterval(() => void poll(), 15_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  return { chain, height, down };
}

function WalletLine() {
  const { t } = useLang();
  const { wallet, forget } = useTryWallet();
  const [shown, setShown] = useState(false);
  // Forgetting can't be undone unless the words were saved: the first tap asks, the second forgets.
  const [confirmForget, setConfirmForget] = useState(false);
  useEffect(() => {
    if (!confirmForget) return;
    const t = setTimeout(() => setConfirmForget(false), 5_000);
    return () => clearTimeout(t);
  }, [confirmForget]);
  if (!wallet) return <p className="text-[13.5px] text-[#5d646d]">{t("No ID yet: your first post or message makes one in this tab.")}</p>;
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
    <div className="text-[13.5px]">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span>
          {t("your ID")}{" "}
          <span translate="no" className={cx(MONO, INK.named)}>
            {wallet.walletId.slice(0, 8)}
          </span>
        </span>
        <Button kind="quiet" className="text-[13.5px]" onClick={() => setShown(!shown)}>
          {shown ? t("hide passphrase") : t("passphrase")}
        </Button>
        <Button kind="quiet" className="text-[13.5px]" onClick={onDownload}>
          {t("save")}
        </Button>
        <Button
          kind="quiet"
          className="text-[13.5px]"
          onClick={() => {
            if (!confirmForget) return setConfirmForget(true);
            setConfirmForget(false);
            forget();
          }}
        >
          {confirmForget ? <span className={INK.bad}>{t("tap again to forget it")}</span> : t("forget")}
        </Button>
      </div>
      {shown ? (
        <p translate="no" className={cx(MONO, "mt-1 break-words text-[13px]")}>
          {wallet.words}
        </p>
      ) : null}
      <p className="mt-1 text-[12.5px] text-[#5d646d]">{t("Made in this tab, never sent anywhere. Close the tab without saving the passphrase and it is gone.")}</p>
    </div>
  );
}


/** This node's facts and this page's provenance: the right rail on inner pages, behind "this node" on home. */
function NodeFacts(props: { node: ReturnType<typeof useNode> }) {
  const { t } = useLang();
  const { wallet, anon, prover } = useTryWallet();
  const { chain, height, down } = props.node;
  const row = (k: string, v: ReactNode) => (
    <>
      <dt className="text-[#5d646d]">{k}</dt>
      <dd className={cx(MONO, "m-0 break-words text-[13px]")}>{v}</dd>
    </>
  );
  return (
    <>
      <h2 className="mb-2 text-[13px] font-semibold text-[#5d646d]">{t("This node")}</h2>
      <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {row(t("chain"), chain?.chainId ?? "…")}
        {row(t("genesis"), chain ? `${chain.genesis.slice(0, 14)}…` : "…")}
        {row(t("height"), down ? <span className={INK.bad}>{t("not answering")}</span> : <span className="tabular-nums">{height?.toLocaleString() ?? "…"}</span>)}
        {row(t("api"), BASE)}
        {row(
          t("you"),
          wallet ? (
            <span title={wallet.walletId} data-wallet-id={wallet.walletId}>
              {wallet.walletId.slice(0, 8)}
            </span>
          ) : (
            t("no ID yet")
          ),
        )}
        {row(
          t("anon set"),
          anon ? (anon.member ? t("{n} members · you're in", { n: anon.members }) : t("{n} members", { n: anon.members })) : wallet ? "…" : t("shown once you have an ID"),
        )}
        {row(t("prover"), prover === "found" ? t("found (this computer)") : prover === "missing" ? t("not found") : t("checking…"))}
      </dl>
      <h2 className="mb-2 text-[13px] font-semibold text-[#5d646d]">{t("This page")}</h2>
      <p className="mb-2 text-[#3d434a]">
        <a className="underline" href={BUILD_SHA ? `${REPO}/tree/${BUILD_SHA}/tet-network/ui` : `${REPO}/tree/main/tet-network/ui`} target="_blank" rel="noreferrer">
          {t("verify this page")}
        </a>
        :{" "}
        {BUILD_SHA ? t("built from {sha}; rebuild it and compare.", { sha: BUILD_SHA.slice(0, 10) }) : t("the source it was built from. This build doesn't name its commit.")}{" "}
        {t("Builds are not signed yet.")}
      </p>
      <p className="text-[#3d434a]">
        <a className="underline" href={`${REPO}/blob/main/docs/DEMO_NODE.md`} target="_blank" rel="noreferrer">
          {t("how this demo works")}
        </a>{" "}
        ·{" "}
        <a className="underline" href={REPO} target="_blank" rel="noreferrer">
          {t("source")}
        </a>
      </p>
    </>
  );
}


/** Inner pages' top bar: a small logo (home), the search box, and the wallet in one short line. */
function TopBar(props: { go: (v: View) => void; onSearch: (q: string) => void }) {
  const { t } = useLang();
  const [q, setQ] = useState("");
  return (
    <header className="sticky top-0 z-20 border-b border-[#e3e5e8] bg-white">
      <div className="mx-auto flex max-w-[48rem] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:px-5">
        <button type="button" onClick={() => props.go({ tool: "home" })} className={cx(FOCUS, "shrink-0 rounded-full")} aria-label={t("TET home")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/tet-logo.svg" width={30} height={30} alt="" className="tet-logo h-[30px] w-[30px]" />
        </button>
        <form
          role="search"
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) props.onSearch(q.trim());
          }}
        >
          <input
            aria-label={t("Search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("Proof code, or search threads")}
            className={cx(FOCUS, "w-full rounded-full border border-[#c9ced4] bg-white px-3.5 py-1.5 text-[15px]")}
          />
        </form>
        <CompactWallet />
      </div>
    </header>
  );
}

/** "a1b2c3d4 · save 12 words": this tab's wallet in one short line (the rest is under "this node"). */
/** Read once, before this visit marks itself visited (ContinueBlock): is this a returning visitor? */
const RETURNING = typeof window !== "undefined" && getUi("tet.ui.v1.visited") === "1";

/**
 * This tab's ID in one short line. Keeping it ("save your passphrase") is offered when the visitor
 * asks (tap the ID) or on a returning visit — not pushed on the first one.
 */

function CompactWallet() {
  const { t } = useLang();
  const { wallet } = useTryWallet();
  const [offer, setOffer] = useState(RETURNING);
  // The ID's testnet balance, read only when the ID area is open (home makes no extra request).
  const [balance, setBalance] = useState<string | null>(null);
  useEffect(() => {
    if (!offer || !wallet) return;
    let on = true;
    void fetch(`${BASE}/ledger/balance/${wallet.walletId}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ balance_micro_tet?: number }>) : null))
      .then((j) => on && j && setBalance(formatTet(j.balance_micro_tet ?? 0)))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [offer, wallet]);
  if (!wallet) return null;
  const save = () => {
    const url = URL.createObjectURL(new Blob([wordsFileText(wallet.words, wallet.walletId)], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tet-testnet-wallet-${wallet.walletId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  // The ID stays in the bar; when open, its details take their own full-width row under it (the bar
  // wraps), so they never squeeze the search box on a phone.
  return (
    <>
      <button
        type="button"
        aria-expanded={offer}
        aria-controls="id-details"
        title={t("your ID")}
        onClick={() => setOffer(!offer)}
        className={cx(FOCUS, MONO, INK.named, "shrink-0 rounded-sm text-[13px]")}
      >
        {wallet.walletId.slice(0, 8)}
      </button>
      {offer ? (
        <div id="id-details" className="basis-full text-right text-[13px] text-[#5d646d]">
          {balance !== null ? (
            <>
              <span>{t("{amount} TET (practice unit, can't be exchanged for money)", { amount: balance })}</span>
              {" · "}
            </>
          ) : null}
          <button type="button" className={cx(FOCUS, "rounded-sm underline underline-offset-2")} onClick={save}>
            {t("Keep this ID? Save your passphrase (12 words)")}
          </button>
          <span className="block">{t("Lose your passphrase (12 words) and nobody can recover it.")} {t("TET asks for your passphrase (12 words) only on the restore screen; support never DMs you.")}</span>
          <div className="mt-2 flex justify-end text-left">
            <div>
              <p className="font-semibold text-[#1c1f23]">{t("my ID")}</p>
              <IdCard walletId={wallet.walletId} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Every page's footer: the other tools and open boards, the IP note, "this node", About · Terms, language. */
function PageFooter(props: { node: ReturnType<typeof useNode>; go: (v: View) => void; ipNote: string; boards: OpenBoard[]; shelter: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const link = cx(FOCUS, "rounded-sm underline underline-offset-2");
  const tools: [View, string][] = [
    [{ tool: "genuine" }, t("Mark as genuine")],
    [{ tool: "seal" }, t("Sealed prediction")],
    [{ tool: "what" }, t("What is TET")],
    [{ tool: "inside" }, t("Inside")],
    [{ tool: "directory" }, t("Public boards")],
    [{ tool: "questions" }, t("Questions for humans")],
    ...(props.shelter ? ([[{ tool: "shelter" }, t("Shelter")]] as [View, string][]) : []),
    [{ tool: "new" }, t("start or open a board")],
    [{ tool: "verify" }, t("verify")],
    [{ tool: "sign" }, t("sign")],
    [{ tool: "qr" }, t("qr")],
    [{ tool: "files" }, t("files")],
    [{ tool: "site" }, t("site")],
    [{ tool: "mail" }, t("DM")],
    [{ tool: "live" }, t("live")],
  ];
  const line = (items: [View, string][]) =>
    items.map(([v, label], i) => (
      <span key={i}>
        {i ? " · " : ""}
        <button type="button" className={link} onClick={() => props.go(v)}>
          {label}
        </button>
      </span>
    ));
  return (
    <footer className="border-t border-[#e3e5e8] px-4 py-3 text-[13px] text-[#5d646d] md:px-5">
      <nav aria-label={t("Tools")} className="mb-2 leading-relaxed">
        {line(tools)}
      </nav>
      {props.boards.length ? (
        <p className="mb-2 leading-relaxed">
          {t("open boards:")} {line(props.boards.map((b) => [{ board: b.invite }, b.name || t("Untitled board")] as [View, string]))}
        </p>
      ) : null}
      <p className="font-semibold text-[#6b4e00]">{t("This is a testnet. Data may be reset.")}</p>
      <p>{props.ipNote}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" aria-expanded={open} aria-controls="node-facts" className={link} onClick={() => setOpen(!open)}>
          {t("this node")}
        </button>
        <button type="button" className={link} onClick={() => props.go({ tool: "about" })}>
          {t("About")}
        </button>
        <button type="button" className={link} onClick={() => props.go({ tool: "terms" })}>
          {t("Terms")}
        </button>
        <a className={link} href="/whitepaper">
          {t("Technical paper")}
        </a>
        <div className="ml-auto">
          <LangSwitch />
        </div>
      </div>
      {open ? (
        <div id="node-facts" className="mt-3 max-w-md space-y-4 text-[14px] text-[#1c1f23]">
          <WalletLine />
          <div>
            <NodeFacts node={props.node} />
          </div>
        </div>
      ) : null}
    </footer>
  );
}

function TryApp() {
  const { t } = useLang();
  const node = useNode();
  // Shelter is listed only on a node that runs it (tmail/shelter.rs).
  const [shelter, setShelter] = useState(false);
  useEffect(() => {
    let live = true;
    void shelterOpen(BASE).then((o) => live && setShelter(o));
    return () => {
      live = false;
    };
  }, []);
  const [boards, setBoards] = useState<OpenBoard[]>([]);
  /** The landing's "try this" hint for Sign, and the last board this device opened (device_store). */
  const [signHint, setSignHint] = useState("");
  // A proof-code link (`/try#code=TET-…`): search it on the home view. After the #, so never sent.
  const [codeQuery] = useState(() => (typeof window !== "undefined" && window.location.hash.startsWith("#code=") ? decodeURIComponent(window.location.hash.slice(6)) : ""));
  const [lastBoard, setLastBoard] = useState<{ name: string; invite: string | null } | null>(null);
  useEffect(() => {
    const t0 = setTimeout(() => {
      try {
        const v = JSON.parse(getUi("tet.ui.v1.lastBoard") ?? "null");
        if (v && typeof v.name === "string") setLastBoard({ name: v.name, invite: typeof v.invite === "string" ? v.invite : null });
      } catch {
        /* nothing remembered */
      }
    }, 0);
    return () => clearTimeout(t0);
  }, []);
  // Home from the first paint (server and client alike), so nothing else flashes before it; a board
  // link or ?tab= moves on from here once it resolves.
  const [view, setView] = useState<View>({ tool: "home" });
  const [opened, setOpened] = useState<Set<string>>(() => new Set(["t:home"]));
  const [homeSearch, setHomeSearch] = useState<{ q: string; n: number } | undefined>(undefined);
  const [boardErr, setBoardErr] = useState("");
  const [directory, setDirectory] = useState<OpenBoard | null>(null);
  const [listings, setListings] = useState<Awaited<ReturnType<typeof readDirectory>> | null>(null);
  // Remember the last PUBLIC board read (device_store, plain UI state; its invite is public anyway).
  // An invite-only board leaves no record on the device, not even its name (commit security
  // review of #70).
  useEffect(() => {
    if (!("board" in view)) return;
    const b = boards.find((x) => x.invite === view.board);
    if (!b || !listings?.some((l) => l.boardWalletId === b.boardWalletId)) return;
    setUi("tet.ui.v1.lastBoard", JSON.stringify({ name: b.name || b.boardWalletId.slice(0, 8), invite: b.invite }));
  }, [view, boards, listings]);
  const [dirErr, setDirErr] = useState("");
  /** The 12 words of boards this tab created (to list them again); kept in memory only. */
  const [boardWords, setBoardWords] = useState<Record<string, string>>({});
  const [dmTarget, setDmTarget] = useState<{ walletId: string; at: number } | null>(null);

  const refreshDirectory = useCallback(async (d: OpenBoard) => {
    try {
      setListings(await readDirectory(BASE, d));
      setDirErr("");
    } catch (e: unknown) {
      setDirErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!DIRECTORY_INVITE) return;
    let live = true;
    void openBoard(BASE, DIRECTORY_INVITE)
      .then((d) => {
        if (!live) return;
        setDirectory(d);
        void refreshDirectory(d);
      })
      .catch((e: unknown) => live && setDirErr(`The directory didn't open: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      live = false;
    };
  }, [refreshDirectory]);

  /** Set once the visitor picks a view; the first-load default never overrides that choice. */
  const chosen = useRef(false);
  const go = useCallback((v: View) => {
    chosen.current = true;
    setView(v);
    setOpened((o) => (o.has(viewKey(v)) ? o : new Set(o).add(viewKey(v))));
    const url = new URL(window.location.href);
    if ("tool" in v && v.tool !== "new") url.searchParams.set("tab", v.tool);
    else url.searchParams.delete("tab");
    if ("board" in v) url.hash = `board=${v.board}`;
    window.history.replaceState(null, "", url);
    window.scrollTo({ top: 0 });
  }, []);

  const addBoard = useCallback(
    (b: OpenBoard, words?: string) => {
      if (words) setBoardWords((w) => ({ ...w, [b.boardWalletId]: words }));
      setBoards((bs) => (bs.some((x) => x.invite === b.invite) ? bs : [...bs, b]));
      go({ board: b.invite });
    },
    [go],
  );

  // First load: the board in the `#`, or the tool in `?tab=`.
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    const tool: ToolId | undefined = TOOLS.find((t) => t.id === tab)?.id ?? (tab === "home" || tab === "how" || tab === "what" || tab === "inside" ? tab : undefined);
    const h = window.location.hash;
    let live = true;
    if (h.startsWith("#board=")) {
      void openBoard(BASE, h)
        .then((b) => {
          if (!live) return;
          setBoards((bs) => (bs.some((x) => x.invite === b.invite) ? bs : [...bs, b]));
          if (!tool && !chosen.current) go({ board: b.invite });
        })
        .catch((e: unknown) => live && setBoardErr(e instanceof Error ? e.message : String(e)));
    }
    // A board link waits for its board; anything else opens at once.
    const t =
      tool || !h.startsWith("#board=")
        ? setTimeout(() => {
            if (!chosen.current) go(tool ? { tool } : { tool: "home" });
          }, 0)
        : undefined;
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [go]);

  const TOOL_LABEL: Record<string, string> = {
    directory: t("Public boards"),
    questions: t("Questions for humans"),
    shelter: t("Shelter"),
    verify: t("verify"),
    sign: t("sign"),
    genuine: t("Mark as genuine"),
    seal: t("Sealed prediction"),
    qr: t("qr"),
    files: t("files"),
    site: t("site"),
    mail: t("DM"),
    new: t("start or open a board"),
    home: t("TET: start here"),
    how: t("How it works"),
    what: t("What is TET"),
    about: t("About"),
    terms: t("Terms"),
    live: t("live"),
  };
  const isHome = "tool" in view && view.tool === "home";
  const ipNote = t("Testnet. The demo node sees your IP address and doesn't write it to any log; it keeps it in memory only to limit requests. For IP privacy, use Tor or your own node. Run by one person; nothing here is audited.");
  const title = "board" in view ? boards.find((b) => b.invite === view.board)?.name || t("Untitled board") : TOOL_LABEL[view.tool];

  // Once opened, a panel stays mounted (hidden), so switching back keeps its state.
  const panel = (v: View, el: ReactNode) =>
    opened.has(viewKey(v)) ? (
      <div key={viewKey(v)} className={viewKey(v) !== viewKey(view) ? "hidden" : "tool" in v && v.tool === "home" ? "flex flex-1 flex-col" : undefined}>
        {el}
      </div>
    ) : null;

  const boardName = (inv: string) => boards.find((b) => b.invite === inv)?.name || t("Untitled board");
  const crumbs: { label: string; v?: View }[] =
    "board" in view
      ? [{ label: t("Public boards"), v: { tool: "directory" } }, { label: boardName(view.board) }]
      : [{ label: title }];

  return (
    <div id="top" className="try-root flex min-h-screen flex-col touch-manipulation bg-white text-base text-[#1c1f23] [-webkit-tap-highlight-color:transparent] [font-family:ui-sans-serif,system-ui,-apple-system,'Segoe_UI',Roboto,sans-serif]">
      <a href="#panel" className={cx(FOCUS, "sr-only rounded bg-white px-3 py-2 focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-30")}>
        {t("Skip to the panel")}
      </a>

      {isHome ? null : (
        <TopBar
          go={go}
          onSearch={(q) => {
            setHomeSearch({ q, n: Date.now() });
            go({ tool: "home" });
          }}
        />
      )}

      <main id="panel" className={cx("flex min-w-0 flex-1 scroll-mt-16 flex-col", !isHome && "mx-auto w-full max-w-[48rem]")}>
        {isHome ? null : (
          <nav aria-label={t("Breadcrumb")} className="px-4 pt-3 text-[13.5px] text-[#5d646d] md:px-5">
            <button type="button" className={cx(FOCUS, "rounded-sm underline underline-offset-2")} onClick={() => go({ tool: "home" })}>
              TET
            </button>
            {crumbs.map((c, i) => (
              <span key={i}>
                {" › "}
                {c.v ? (
                  <button type="button" className={cx(FOCUS, "rounded-sm underline underline-offset-2")} onClick={() => go(c.v!)}>
                    {c.label}
                  </button>
                ) : (
                  <span aria-current="page">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
          {boardErr ? <p className={cx("px-4 py-2 text-[15px]", INK.bad)}>{t("This invite didn't open: {reason}", { reason: boardErr })}</p> : null}
          {boards.map((b) =>
            panel(
              { board: b.invite },
              <BoardPanel
                board={b}
                isPublic={!!listings?.some((l) => l.boardWalletId === b.boardWalletId)}
                boardWords={boardWords[b.boardWalletId]}
                directory={directory}
                onListed={() => directory && void refreshDirectory(directory)}
                onDm={(walletId) => {
                  setDmTarget({ walletId, at: Date.now() });
                  go({ tool: "mail" });
                }}
              />,
            ),
          )}
          {panel({ tool: "directory" }, <DirectoryPanel directory={directory} listings={listings} error={dirErr} onOpen={addBoard} />)}
          {panel({ tool: "new" }, <NewBoardPanel directory={directory} onOpen={addBoard} onListed={() => directory && void refreshDirectory(directory)} />)}
          {panel({ tool: "questions" }, <QuestionsPanel />)}
          {panel({ tool: "shelter" }, <ShelterPanel active={"tool" in view && view.tool === "shelter"} />)}
          {panel({ tool: "verify" }, <VerifyPanel baseUrl={BASE} />)}
          {panel({ tool: "sign" }, <SignPanel hint={signHint} />)}
          {panel({ tool: "genuine" }, <GenuinePanel />)}
          {panel({ tool: "seal" }, <SealPanel />)}
          {panel(
            { tool: "home" },
            <HomePanel
              go={(tool) => go({ tool: tool as ToolId })}
              search={homeSearch}
              listings={listings}
              listingsError={dirErr}
              onBoard={addBoard}
              lastBoard={lastBoard}
              onOpenBoard={(invite) => void openBoard(BASE, invite).then(addBoard).catch((e: unknown) => setBoardErr(e instanceof Error ? e.message : String(e)))}
              initialQuery={codeQuery}
            />,
          )}
          {panel(
            { tool: "how" },
            <HowPanel
              go={(tool, hint) => {
                setSignHint(hint ?? "");
                go({ tool: tool as ToolId });
              }}
            />,
          )}
          {panel({ tool: "what" }, <WhatPanel go={(tool) => go({ tool: tool as ToolId })} />)}
          {panel({ tool: "inside" }, <InsidePanel listings={listings} go={(tool) => go({ tool: tool as ToolId })} />)}
          {panel({ tool: "qr" }, <QrPanel />)}
          {panel({ tool: "site" }, <SitePanel />)}
          {panel({ tool: "files" }, <FilesTryPanel demoContact={DEMO_CONTACT} active={"tool" in view && view.tool === "files"} />)}
          {panel({ tool: "mail" }, <MailPanel demoContact={DEMO_CONTACT} dmTarget={dmTarget} active={"tool" in view && view.tool === "mail"} />)}
          {panel({ tool: "about" }, <AboutPanel />)}
          {panel({ tool: "terms" }, <TermsPanel />)}
          {panel({ tool: "live" }, <LivePanel />)}
        {isHome ? null : (
          <p className="px-4 py-4 text-[14px] md:px-5">
            <a href="#top" className={cx(FOCUS, "rounded-sm underline underline-offset-2")}>
              {t("← back to top")}
            </a>
          </p>
        )}
      </main>

      {isHome ? <LiveStrip /> : null}
      <PageFooter node={node} go={go} ipNote={ipNote} boards={boards} shelter={shelter} />
    </div>
  );
}

export default function TryPage() {
  return (
    <LangProvider>
      <WalletProvider>
        <TryApp />
      </WalletProvider>
    </LangProvider>
  );
}
