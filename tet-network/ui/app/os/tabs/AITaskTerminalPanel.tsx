"use client";

import type { RefObject } from "react";
import Win95Panel from "../components/Win95Panel";
import { bevel, surface, buttonBevel, cx } from "../components/tokens";

/** Chat row (mirrors the legacy `AiChatMessage` shape in OsClient). */
export type AiChatMessageView = {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  status?: "queued" | "error";
};

export type AITaskTerminalPanelProps = {
  /** Scroll container ref (owner auto-scrolls on new messages). */
  chatScrollRef: RefObject<HTMLDivElement | null>;
  bestNumber: number | null;
  statusWorkers: number | null;
  messages: ReadonlyArray<AiChatMessageView>;
  submitting: boolean;
  onSubmit: () => void;
  prompt: string;
  onPromptChange: (v: string) => void;
  signerReady: boolean;
  /** Owner-computed: submitting || !signerReady || escrow<=0 || empty prompt. */
  sendDisabled: boolean;
  /** Byte length of the prompt (owner computes via `stringToU8a`). */
  promptBytes: number;
  promptMaxBytes: number;
  lastTaskId: string | null;
};

/**
 * AI Task Terminal (default tab) — chat-style demand console.
 *
 * Extracted verbatim from `OsClient.tsx` onto the `Win95*`/token design system; visual output
 * is identical. Stateless: prompt text, chat list, and submit handler are owned by `OsClient`.
 */
export default function AITaskTerminalPanel(props: AITaskTerminalPanelProps) {
  const {
    chatScrollRef,
    bestNumber,
    statusWorkers,
    messages,
    submitting,
    onSubmit,
    prompt,
    onPromptChange,
    signerReady,
    sendDisabled,
    promptBytes,
    promptMaxBytes,
    lastTaskId,
  } = props;

  return (
    <Win95Panel variant="outset" className="p-2 flex h-[min(72vh,700px)] min-h-[520px] flex-col overflow-hidden">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <div className="text-sm font-semibold text-black">TET-Network Chat</div>
          <div className="text-[11px] text-black/60">
            Ask naturally. Distributed compute, proof, and settlement happen behind the scenes.
          </div>
        </div>
        <div className={cx(bevel.inset, surface.field, "px-2 py-1 text-[11px] font-mono text-black/70")}>
          Block {bestNumber == null ? "—" : bestNumber.toLocaleString("en-US")} · Workers {statusWorkers ?? "—"}
        </div>
      </div>

      <div
        ref={chatScrollRef}
        className={cx(bevel.inset, "flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[#f5f3ea] p-3 text-sm")}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.map((m) => {
            const isUser = m.role === "user";
            return (
              <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={[
                    "max-w-[86%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 shadow-sm",
                    isUser
                      ? "bg-[#000080] text-white rounded-br-sm"
                      : m.status === "error"
                        ? "bg-[#fff1f1] text-[#7a1010] border border-[#d28a8a] rounded-bl-sm"
                        : "bg-white text-black border border-black/10 rounded-bl-sm",
                  ].join(" ")}
                >
                  <div className="mb-1 text-[10px] font-mono opacity-65">
                    {isUser ? "You" : "TET-Network"} · {m.ts > 0 ? new Date(m.ts).toLocaleTimeString() : "ready"}
                  </div>
                  <div className="leading-relaxed">{m.text}</div>
                  {m.status === "queued" ? (
                    <div className="mt-2 text-[11px] font-mono text-[#0b5c2e]">
                      L1 accepted · proof settlement pending
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

          {submitting ? (
            <div className="flex justify-start">
              <div className="max-w-[86%] rounded-2xl rounded-bl-sm border border-[#00a0a0]/30 bg-white px-4 py-3 text-black shadow-sm">
                <div className="mb-2 text-[10px] font-mono text-black/55">TET-Network</div>
                <div className="space-y-1.5 font-mono text-xs">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[#000080]" />
                    Waiting for Network Compute...
                  </div>
                  <div className="flex items-center gap-2 text-black/70">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[#008080] [animation-delay:160ms]" />
                    Dispatching to worker mesh...
                  </div>
                  <div className="flex items-center gap-2 text-black/60">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[#0b5c2e] [animation-delay:320ms]" />
                    ZK Proving...
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className={cx(bevel.outset, surface.panel, "mt-2 shrink-0 p-2")}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            rows={2}
            disabled={submitting}
            className={cx(bevel.inset, surface.field, "min-h-[3rem] flex-1 resize-none px-3 py-2 text-sm outline-none")}
            placeholder="Message TET-Network..."
          />
          <button
            type="submit"
            disabled={sendDisabled}
            className={cx(
              buttonBevel,
              surface.panel,
              "px-4 py-3 text-sm font-semibold disabled:opacity-50 disabled:active:translate-x-0 disabled:active:translate-y-0",
            )}
          >
            {submitting ? "Sending..." : "Send"}
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-black/50">
          <span>
            {signerReady ? "Wallet ready" : "Unlock wallet from File -> Wallet"} · Shift+Enter for newline
          </span>
          <span className="font-mono">
            {promptBytes} / {promptMaxBytes} bytes
            {lastTaskId ? ` · last task ${lastTaskId.slice(0, 12)}...` : ""}
          </span>
        </div>
      </form>
    </Win95Panel>
  );
}
