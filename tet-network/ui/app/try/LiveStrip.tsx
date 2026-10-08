"use client";

/**
 * The home page's live strip: this node's newest blocks, raw, as a few monospace lines at the bottom
 * of the page (GET /explorer/blocks/recent every 5 s). Oldest on top, so a new block pushes the lines
 * up. Each line's `prev` is shown matching the hash on the line above, so the chain link is visible.
 *
 * Real data only: nothing is generated, nothing animates on its own. No new block, no change; node
 * down, it says so. Public header and tx metadata only (hash, kind, the tx signer's two signatures,
 * shortened). Blocks carry no producer signature yet, and the strip says that rather than show one.
 */
import { useEffect, useState } from "react";
import { MONO, cx } from "./ui";
import { BASE } from "./wallet";
import { useLang } from "./i18n";

type Tx = { hash: string; kind: string; ed25519_sig: string; mldsa44_sig: string };
type Block = { height: number; block_id: string; parent_block_id: string | null; state_root: string; tx_count: number; ts_ms: number; producer_id: string; txs: Tx[] };

const LINES = 5;
const hms = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const h = (s: string | null | undefined, n = 10) => (s ? s.replace(/^0x/, "").slice(0, n) : "—");

export default function LiveStrip() {
  const { t } = useLang();
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  const [down, setDown] = useState("");
  useEffect(() => {
    let on = true;
    let last = "";
    const load = async () => {
      try {
        const r = await fetch(`${BASE}/explorer/blocks/recent?n=${LINES}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { blocks?: Block[] };
        const bs = [...(j.blocks ?? [])].reverse(); // oldest first: new blocks push lines up
        const key = bs.map((b) => b.block_id).join(",");
        if (on) {
          setDown("");
          if (key !== last) {
            last = key;
            setBlocks(bs);
          }
        }
      } catch (e: unknown) {
        if (on) setDown(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const id = setInterval(() => void load(), 5_000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div
      role="log"
      aria-label={t("This node's newest blocks")}
      className={cx(MONO, "tet-strip overflow-x-auto whitespace-pre bg-[#16181b] px-4 py-2 text-[12px] leading-[1.6] text-[#c9d1d9] md:px-5")}
    >
      {down ? (
        <p className="text-[#f19a9a]">{t("node not answering: {why}", { why: down })}</p>
      ) : !blocks ? (
        <p className="text-[#6c737b]">…</p>
      ) : (
        <>
          <p className="text-[#6c737b]">
            {t("newest blocks on this node · blocks aren't signed by their producer yet; the signatures shown are each transaction's signer's (ed25519 · ML-DSA-44)")}
          </p>
          {blocks.length === 0 ? <p className="text-[#6c737b]">{t("no blocks yet")}</p> : null}
          {blocks.map((b, i) => {
            const above = blocks[i - 1];
            const linked = !!above && !!b.parent_block_id && b.parent_block_id === above.block_id;
            return (
              <p key={b.block_id}>
                <span className="text-[#8fd3a8]">#{b.height}</span> <span className="text-[#6c737b]">hash</span> {h(b.block_id)}{" "}
                <span className="text-[#6c737b]">prev</span>{" "}
                <span className={linked ? "text-[#8fd3a8]" : undefined} title={linked ? t("matches the hash on the line above") : undefined}>
                  {linked ? "=" : ""}
                  {h(b.parent_block_id)}
                </span>{" "}
                <span className="text-[#6c737b]">root</span> {h(b.state_root, 8)} <span className="text-[#6c737b]">txs</span> {b.tx_count} <span className="text-[#6c737b]">t</span> {b.ts_ms} <span className="text-[#6c737b]">({hms(b.ts_ms)})</span>{" "}
                <span className="text-[#6c737b]">by</span> {b.producer_id.slice(0, 12)}
                {b.txs.map((x) => (
                  <span key={x.hash}>
                    {"  "}
                    <span className="text-[#6c737b]">tx</span> {h(x.hash, 8)} {x.kind} <span className="text-[#6c737b]">ed</span> {x.ed25519_sig.slice(0, 8)} <span className="text-[#6c737b]">ml</span> {x.mldsa44_sig.slice(0, 8)}
                  </span>
                ))}
              </p>
            );
          })}
        </>
      )}
    </div>
  );
}
