"use client";

/** Start a board, or open one by its invite. The shell adds it to the sidebar and selects it. */
import { useState } from "react";
import { createBoard, openBoard, type OpenBoard } from "../lib/try_board";
import { Button, INK, Input, PanelHead, PinnedNotice, cx } from "./ui";
import { BASE } from "./wallet";

export default function NewBoardPanel(props: { onOpen: (b: OpenBoard) => void }) {
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go(make: () => Promise<OpenBoard>) {
    setErr("");
    setBusy(true);
    try {
      props.onOpen(await make());
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Start or open a board">
      <PanelHead title="Start or open a board" todo="Name a new board and start it, or paste an invite link to open one." />
      <div className="max-w-[34rem] space-y-5 px-4 py-4 md:px-5">
        <PinnedNotice
          lines={[
            "A board is readable by anyone with its invite link. The link is the key; it sits after the #, so it is never sent to the node.",
            "An invite cannot be revoked: to shut people out, start a new board.",
          ]}
        />
        <div className="space-y-2">
          <Input label="Board name (optional)" value={name} onChange={setName} placeholder="e.g. Study group…" />
          <Button disabled={busy} onClick={() => void go(async () => (await createBoard(BASE, name)).board)}>
            Start the board
          </Button>
        </div>
        <div className="space-y-2">
          <Input label="Invite link" value={invite} onChange={setInvite} mono placeholder="…/try#board=tetboard1…" />
          <Button kind="secondary" disabled={busy || !invite.trim()} onClick={() => void go(() => openBoard(BASE, invite))}>
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
