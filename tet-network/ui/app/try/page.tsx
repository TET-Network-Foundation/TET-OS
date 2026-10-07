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
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { wordsFileText } from "../lib/disposable_wallet.mjs";
import { openBoard, readDirectory, type OpenBoard } from "../lib/try_board";
import DirectoryPanel from "./DirectoryPanel";
import BoardPanel from "./BoardPanel";
import FilesTryPanel from "./FilesTryPanel";
import MailPanel from "./MailPanel";
import NewBoardPanel from "./NewBoardPanel";
import QuestionsPanel from "./QuestionsPanel";
import VerifyPanel from "./VerifyPanel";
import { Button, FOCUS, INK, MONO, cx } from "./ui";
import { BASE, WalletProvider, useTryWallet } from "./wallet";

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
  { id: "verify", label: "verify", group: "tools" },
  { id: "files", label: "files", group: "tools" },
  { id: "mail", label: "DM", group: "tools" },
] as const;
type ToolId = (typeof TOOLS)[number]["id"] | "new";
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
  const { wallet, forget } = useTryWallet();
  const [shown, setShown] = useState(false);
  // Forgetting can't be undone unless the words were saved: the first tap asks, the second forgets.
  const [confirmForget, setConfirmForget] = useState(false);
  useEffect(() => {
    if (!confirmForget) return;
    const t = setTimeout(() => setConfirmForget(false), 5_000);
    return () => clearTimeout(t);
  }, [confirmForget]);
  if (!wallet) return <p className="text-[13.5px] text-[#5d646d]">No wallet yet: your first post or message makes one in this tab.</p>;
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
          wallet{" "}
          <span translate="no" className={cx(MONO, INK.named)}>
            {wallet.walletId.slice(0, 8)}
          </span>
        </span>
        <Button kind="quiet" className="text-[13.5px]" onClick={() => setShown(!shown)}>
          {shown ? "hide words" : "12 words"}
        </Button>
        <Button kind="quiet" className="text-[13.5px]" onClick={onDownload}>
          save
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
          {confirmForget ? <span className={INK.bad}>tap again to forget it</span> : "forget"}
        </Button>
      </div>
      {shown ? (
        <p translate="no" className={cx(MONO, "mt-1 break-words text-[13px]")}>
          {wallet.words}
        </p>
      ) : null}
      <p className="mt-1 text-[12.5px] text-[#5d646d]">Made in this tab, never sent anywhere. Close the tab without saving the words and it is gone.</p>
    </div>
  );
}

/** The channel list: the sidebar on wide screens, the switcher menu on a phone. */
function Channels(props: { boards: OpenBoard[]; view: View; go: (v: View) => void }) {
  const item = (v: View, prefix: string, label: string) => {
    const on = viewKey(v) === viewKey(props.view);
    return (
      <li key={viewKey(v)}>
        <button
          type="button"
          onClick={() => props.go(v)}
          aria-current={on ? "page" : undefined}
          className={cx(FOCUS, "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[15px]", on ? "bg-[#e2e5e9] font-semibold" : "hover:bg-[#e8eaed]")}
        >
          <span aria-hidden="true" className={cx(MONO, "text-[#5d646d]")}>
            {prefix}
          </span>
          <span className="truncate">{label}</span>
        </button>
      </li>
    );
  };
  return (
    <nav aria-label="Channels">
      <h2 className="mx-2 mb-1 mt-3 text-[13px] font-semibold text-[#5d646d]">boards</h2>
      <ul>
        {item({ tool: "directory" }, "/", "Public boards")}
        {props.boards.map((b) => item({ board: b.invite }, "#", b.name || "Untitled board"))}
        {item({ tool: "questions" }, "#", "Questions for humans")}
      </ul>
      <p className="mx-2 mt-1 text-[13.5px]">
        <button type="button" className={cx(FOCUS, "rounded text-[#3d434a] underline")} onClick={() => props.go({ tool: "new" })}>
          start or open a board
        </button>
      </p>
      <h2 className="mx-2 mb-1 mt-4 text-[13px] font-semibold text-[#5d646d]">tools</h2>
      <ul>{TOOLS.filter((t) => t.group === "tools").map((t) => item({ tool: t.id }, "/", t.label))}</ul>
    </nav>
  );
}

function Rail(props: { node: ReturnType<typeof useNode> }) {
  const { wallet, anon, prover } = useTryWallet();
  const { chain, height, down } = props.node;
  const row = (k: string, v: ReactNode) => (
    <>
      <dt className="text-[#5d646d]">{k}</dt>
      <dd className={cx(MONO, "m-0 break-words text-[13px]")}>{v}</dd>
    </>
  );
  return (
    <aside aria-label="Node facts" className="hidden border-l border-[#e3e5e8] px-4 py-4 text-[14px] xl:block">
      <h2 className="mb-2 text-[13px] font-semibold text-[#5d646d]">This node</h2>
      <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {row("chain", chain?.chainId ?? "…")}
        {row("genesis", chain ? `${chain.genesis.slice(0, 14)}…` : "…")}
        {row("height", down ? <span className={INK.bad}>not answering</span> : <span className="tabular-nums">{height?.toLocaleString() ?? "…"}</span>)}
        {row("api", BASE)}
        {row(
          "you",
          wallet ? (
            <span title={wallet.walletId} data-wallet-id={wallet.walletId}>
              {wallet.walletId.slice(0, 8)}
            </span>
          ) : (
            "no wallet yet"
          ),
        )}
        {row("anon set", anon ? `${anon.members} members${anon.member ? " · you're in" : ""}` : wallet ? "…" : "shown once you have a wallet")}
        {row("prover", prover === "found" ? "found (this computer)" : prover === "missing" ? "not found" : "checking…")}
      </dl>
      <h2 className="mb-2 text-[13px] font-semibold text-[#5d646d]">This page</h2>
      <p className="mb-2 text-[#3d434a]">
        <a className="underline" href={BUILD_SHA ? `${REPO}/tree/${BUILD_SHA}/tet-network/ui` : `${REPO}/tree/main/tet-network/ui`} target="_blank" rel="noreferrer">
          verify this page
        </a>
        :{" "}
        {BUILD_SHA ? (
          <>
            built from <span className={MONO}>{BUILD_SHA.slice(0, 10)}</span>; rebuild it and compare.
          </>
        ) : (
          <>the source it was built from. This build doesn&apos;t name its commit.</>
        )}{" "}
        Builds are not signed yet.
      </p>
      <p className="text-[#3d434a]">
        <a className="underline" href={`${REPO}/blob/main/docs/DEMO_NODE.md`} target="_blank" rel="noreferrer">
          how this demo works
        </a>{" "}
        ·{" "}
        <a className="underline" href={REPO} target="_blank" rel="noreferrer">
          source
        </a>
      </p>
    </aside>
  );
}

function TryApp() {
  const node = useNode();
  const [boards, setBoards] = useState<OpenBoard[]>([]);
  const [view, setView] = useState<View>({ tool: "new" });
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState(false);
  const [boardErr, setBoardErr] = useState("");
  const [directory, setDirectory] = useState<OpenBoard | null>(null);
  const [listings, setListings] = useState<Awaited<ReturnType<typeof readDirectory>> | null>(null);
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

  const go = useCallback((v: View) => {
    setView(v);
    setOpened((o) => (o.has(viewKey(v)) ? o : new Set(o).add(viewKey(v))));
    setMenu(false);
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
    const tool = TOOLS.find((t) => t.id === tab)?.id;
    const h = window.location.hash;
    let live = true;
    if (h.startsWith("#board=")) {
      void openBoard(BASE, h)
        .then((b) => {
          if (!live) return;
          setBoards((bs) => (bs.some((x) => x.invite === b.invite) ? bs : [...bs, b]));
          if (!tool) go({ board: b.invite });
        })
        .catch((e: unknown) => live && setBoardErr(e instanceof Error ? e.message : String(e)));
    }
    // A board link waits for its board; anything else opens at once.
    const t = tool || !h.startsWith("#board=") ? setTimeout(() => go(tool ? { tool } : { tool: "new" }), 0) : undefined;
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [go]);

  const title = "board" in view ? boards.find((b) => b.invite === view.board)?.name || "Untitled board" : view.tool === "new" ? "start or open a board" : TOOLS.find((t) => t.id === view.tool)?.label;

  // Once opened, a panel stays mounted (hidden), so switching back keeps its state.
  const panel = (v: View, el: ReactNode) =>
    opened.has(viewKey(v)) ? (
      <div key={viewKey(v)} className={cx(viewKey(v) !== viewKey(view) && "hidden")}>
        {el}
      </div>
    ) : null;

  return (
    <div className="try-root min-h-screen touch-manipulation bg-white text-base text-[#1c1f23] [-webkit-tap-highlight-color:transparent] [font-family:ui-sans-serif,system-ui,-apple-system,'Segoe_UI',Roboto,sans-serif]">
      <a href="#panel" className={cx(FOCUS, "sr-only rounded bg-white px-3 py-2 focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-30")}>
        Skip to the panel
      </a>

      {/* Phone: one top bar with the switcher. */}
      <header className="sticky top-0 z-20 border-b border-[#e3e5e8] bg-white md:hidden">
        <div className="flex items-center gap-3 px-3.5 py-2.5">
          <button
            type="button"
            aria-expanded={menu}
            aria-controls="try-menu"
            onClick={() => setMenu(!menu)}
            className={cx(FOCUS, "flex min-h-10 min-w-0 items-center gap-2 rounded-md border border-[#c9ced4] px-3 text-[15px]")}
          >
            <span aria-hidden="true">≡</span>
            <span className="truncate">{title}</span>
            <span aria-hidden="true" className="text-[11px]">
              ▾
            </span>
          </button>
          <span className={cx(MONO, "ml-auto shrink-0 text-[13px] text-[#5d646d]")}>
            {node.down ? <span className={INK.bad}>node down</span> : <span className="tabular-nums">height {node.height?.toLocaleString() ?? "…"}</span>}
          </span>
        </div>
        {menu ? (
          <div id="try-menu" className="max-h-[75vh] overflow-y-auto border-t border-[#e3e5e8] bg-[#f1f2f4] px-2 pb-3">
            <Channels boards={boards} view={view} go={go} />
            <div className="mx-2 mt-4">
              <WalletLine />
            </div>
          </div>
        ) : null}
      </header>

      <div className="md:grid md:min-h-screen md:grid-cols-[14.5rem_minmax(0,1fr)] xl:grid-cols-[14.5rem_minmax(0,1fr)_16.5rem]">
        <aside className="hidden border-r border-[#e3e5e8] bg-[#f1f2f4] px-2.5 py-3.5 md:block">
          <div className="sticky top-3.5">
            <h1 className="mx-2 text-[16px] font-bold">
              Try TET <span className="text-[14px] font-normal text-[#5d646d]">testnet</span>
            </h1>
            <Channels boards={boards} view={view} go={go} />
            <div className="mx-2 mt-6 border-t border-[#dcdfe3] pt-3">
              <WalletLine />
            </div>
          </div>
        </aside>

        <main id="panel" className="flex min-w-0 scroll-mt-16 flex-col">
          {boardErr ? <p className={cx("px-4 py-2 text-[15px]", INK.bad)}>This invite didn&apos;t open: {boardErr}</p> : null}
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
          {panel({ tool: "verify" }, <VerifyPanel baseUrl={BASE} />)}
          {panel({ tool: "files" }, <FilesTryPanel demoContact={DEMO_CONTACT} />)}
          {panel({ tool: "mail" }, <MailPanel demoContact={DEMO_CONTACT} dmTarget={dmTarget} />)}
          <p className="mt-auto border-t border-[#e3e5e8] px-4 py-3 text-[13px] text-[#5d646d] md:px-5">
            Testnet. The demo node sees your IP address and when you make requests; it is run by one person. Nothing here is audited.
          </p>
        </main>

        <Rail node={node} />
      </div>
    </div>
  );
}

export default function TryPage() {
  return (
    <WalletProvider>
      <TryApp />
    </WalletProvider>
  );
}
