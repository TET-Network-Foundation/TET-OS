"use client";

/**
 * Start a board (public or invite-only), or open one by its invite. The shell adds it to the
 * sidebar and selects it. A public board is listed in the directory by an announcement its own
 * wallet signs (`lib/board_directory.mjs`), so its 12 words are shown once: they are what keeps the
 * board listed past 7 days.
 */
import { useState } from "react";
import { announceBoard, createBoard, openBoard, type OpenBoard } from "../lib/try_board";
import { Button, Chips, INK, Input, MONO, PanelHead, PinnedNotice, cx } from "./ui";
import { BASE } from "./wallet";

export default function NewBoardPanel(props: { directory: OpenBoard | null; onOpen: (b: OpenBoard, boardWords?: string) => void; onListed: () => void }) {
  // Public is the default once the directory has loaded; an explicit choice sticks.
  const [chosen, setKind] = useState<"public" | "invite" | null>(null);
  const kind = chosen ?? (props.directory ? "public" : "invite");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [made, setMade] = useState<{ board: OpenBoard; words: string } | null>(null);

  async function start() {
    setErr("");
    setBusy(true);
    try {
      if (kind === "public" && !name.trim()) throw new Error("A public board needs a name, so people can find it.");
      const { board, ownerWords } = await createBoard(BASE, name);
      if (kind === "public" && props.directory) {
        await announceBoard(BASE, props.directory, board, ownerWords);
        props.onListed();
        setMade({ board, words: ownerWords });
      } else {
        props.onOpen(board);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openInvite() {
    setErr("");
    setBusy(true);
    try {
      props.onOpen(await openBoard(BASE, invite));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (made) {
    return (
      <section aria-label="Your public board">
        <PanelHead title={made.board.name} sub="public · listed" todo="Save the board's 12 words, then open the board." />
        <div className="max-w-[34rem] space-y-3 px-4 py-4 md:px-5">
          <p className="text-[15px]">
            These are the board&apos;s own 12 words, not your wallet&apos;s. A listing lasts 7 days; to keep the board listed, announce it again with
            these words (from the board&apos;s page). They are shown only now.
          </p>
          <p translate="no" className={cx(MONO, "rounded-md border border-[#c9ced4] bg-[#fafbfc] px-3 py-2 text-[14px] break-words")}>
            {made.words}
          </p>
          <Button onClick={() => props.onOpen(made.board, made.words)}>Open the board</Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Start or open a board">
      <PanelHead title="Start or open a board" todo="Choose public or invite-only, name the board and start it, or paste an invite link to open one." />
      <div className="max-w-[34rem] space-y-5 px-4 py-4 md:px-5">
        <PinnedNotice
          lines={[
            "A public board is listed in the directory with its invite, so anyone can read every post. Listing it is signed by the board's own wallet, not yours.",
            "An invite-only board is readable by anyone with its invite link. The link is the key; it sits after the #, so it is never sent to the node.",
            "An invite cannot be revoked: to shut people out, start a new board.",
          ]}
        />
        <div className="space-y-2">
          <Chips
            options={[
              ...(props.directory ? [{ label: "Public (listed)", value: "public" }] : []),
              { label: "Invite only", value: "invite" },
            ]}
            value={kind}
            onChange={(v) => setKind(v as "public" | "invite")}
          />
          <Input label={kind === "public" ? "Board name" : "Board name (optional)"} value={name} onChange={setName} placeholder="e.g. Study group…" />
          <Button disabled={busy} onClick={() => void start()}>
            {busy ? "Starting…" : kind === "public" ? "Start and list the board" : "Start the board"}
          </Button>
        </div>
        <div className="space-y-2">
          <Input label="Invite link" value={invite} onChange={setInvite} mono placeholder="…/try#board=tetboard1…" />
          <Button kind="secondary" disabled={busy || !invite.trim()} onClick={() => void openInvite()}>
            Open the board
          </Button>
        </div>
        {err ? (
          <p role="alert" className={cx("text-[15px]", INK.bad)}>
            {err}
          </p>
        ) : null}
      </div>
    </section>
  );
}
