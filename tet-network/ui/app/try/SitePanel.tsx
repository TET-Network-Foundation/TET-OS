"use client";

/**
 * The site builder (lib/site_lang.ts, lib/site_store.ts): build a page the way you post to a thread.
 * Add a block and it appears; every add or removal is one edit signed by the site's own key. The
 * preview is the exact page a reader gets, rendered in a frame that can't run scripts. Export
 * downloads the page and its signed chain, to host anywhere.
 */
import { useCallback, useEffect, useState } from "react";
import { sha256 } from "@noble/hashes/sha2";
import { applyEdits, checkBlock, render, IMAGE_MAX_BYTES, IMAGE_MIMES, TEMPLATES, type Block, type Lang, type SiteState, type Template } from "../lib/site_lang";
import { appendEdit, fetchSite, newSite, siteIdOf, verifyChain, type ChainVerdict, type SiteEdit } from "../lib/site_store";
import { expectedChainBinding } from "../lib/chain_binding";
import { mldsa44Verify } from "../lib/pqc";
import { Badge, Button, FOCUS, Input, MONO, PanelHead, PinnedNotice, TextArea, Toggle, cx } from "./ui";
import { BASE } from "./wallet";
import { useLang } from "./i18n";

type Kind = Block["type"];
const KINDS: Kind[] = ["heading", "text", "image", "list", "quote", "link"];
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SitePanel() {
  const { t } = useLang();
  const [words, setWords] = useState("");
  const [typed, setTyped] = useState("");
  const [fresh, setFresh] = useState<{ words: string; siteId: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [edits, setEdits] = useState<SiteEdit[]>([]);
  const [verdict, setVerdict] = useState<ChainVerdict | null>(null);
  const [state, setState] = useState<SiteState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // the block being written
  const [kind, setKind] = useState<Kind>("text");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [level, setLevel] = useState<1 | 2 | 3>(2);
  const [ordered, setOrdered] = useState(false);
  const [image, setImage] = useState<Block | null>(null);
  // meta
  const [title, setTitle] = useState("");
  const [lang, setLang] = useState<Lang>("en");
  const [template, setTemplate] = useState<Template>("plain");

  const siteId = words ? siteIdOf(words) : "";

  const load = useCallback(async (id: string) => {
    setErr("");
    try {
      const got = await fetchSite(BASE, id);
      const es = got?.edits ?? [];
      const chain = await expectedChainBinding(BASE);
      const v = await verifyChain(id, es, chain, mldsa44Verify);
      setEdits(es);
      setVerdict(v);
      const st = applyEdits(es.map((e) => e.body));
      setState(st);
      if (es.length) {
        setTitle(st.title);
        setLang(st.lang);
        setTemplate(st.template);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    if (siteId) void load(siteId);
  }, [siteId, load]);

  async function save(op: unknown) {
    setErr("");
    setBusy(true);
    try {
      await appendEdit(BASE, words, op);
      await load(siteId);
      return true;
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function draft(): Block | null {
    switch (kind) {
      case "heading":
        return checkBlock({ type: "heading", level, text: a });
      case "text":
        return checkBlock({ type: "text", text: a });
      case "image":
        return image;
      case "list":
        return checkBlock({ type: "list", ordered, items: a.split("\n").map((x) => x.trim()).filter(Boolean) });
      case "quote":
        return checkBlock({ type: "quote", text: a, ...(b.trim() ? { who: b.trim() } : {}) });
      case "link":
        return checkBlock({ type: "link", url: a.trim(), label: b.trim() || a.trim() });
    }
  }

  async function onImage(f: File | undefined) {
    setImage(null);
    setErr("");
    if (!f) return;
    if (!IMAGE_MIMES.includes(f.type as (typeof IMAGE_MIMES)[number])) return setErr(t("Use a PNG, JPEG, GIF or WebP image."));
    if (f.size > IMAGE_MAX_BYTES) return setErr(t("An image can be at most 1 MB."));
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    setImage(checkBlock({ type: "image", mime: f.type, data_b64: btoa(bin), sha256: hex(sha256(bytes)), alt: b }));
  }

  const block = draft();
  const html = state && verdict?.ok ? render(state, siteId, verdict.version) : "";
  const viewUrl = typeof window !== "undefined" && siteId ? `${window.location.origin}/s/${siteId}` : "";

  if (!words) {
    return (
      <section aria-label={t("Site")}>
        <PanelHead title={t("Site")} sub={t("signed pages, block by block")} todo={t("Make a new site, or open yours with its 12 words.")} />
        <div className="max-w-[46rem] space-y-4 px-4 pb-6 md:px-5">
          <PinnedNotice
            lines={[
              t("Every block on a site is published by the site's own key, in order, and readers check every signature in their own tab. That doesn't show who holds the key, or that a person wrote the text."),
              t("Public: anyone with the link can read a site. This node keeps a site 30 days after its last edit; export it to keep a lasting copy."),
              t("The site's 12 words are its key. The page doesn't keep them: write them down."),
            ]}
          />
          {fresh ? (
            <div className="space-y-2 rounded-md border border-[#e3e5e8] p-3">
              <p className="text-[15px] font-semibold">{t("Your site's 12 words")}</p>
              <p translate="no" className={cx(MONO, "rounded bg-[#fafbfc] p-2 text-[15px]")}>
                {fresh.words}
              </p>
              <p className="text-[14px] text-[#5d646d]">{t("Anyone with these words can edit the site. Without them, nobody can, including you.")}</p>
              <Toggle on={saved} onChange={setSaved}>
                {t("I've written them down")}
              </Toggle>
              <div>
                <Button disabled={!saved} onClick={() => setWords(fresh.words)}>
                  {t("Start building")}
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => setFresh(newSite())}>{t("Make a new site")}</Button>
          )}
          <div className="space-y-2">
            <TextArea label={t("Your site's 12 words")} value={typed} onChange={setTyped} rows={2} placeholder={t("Your site's 12 words")} />
            <Button
              kind="secondary"
              disabled={typed.trim().split(/\s+/).length !== 12}
              onClick={() => {
                try {
                  siteIdOf(typed);
                  setWords(typed.trim());
                } catch {
                  setErr(t("Those aren't 12 valid words."));
                }
              }}
            >
              {t("Open my site")}
            </Button>
          </div>
          {err ? <p className="text-[14px] text-[#8a1f1f]">{err}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <section aria-label={t("Site")}>
      <PanelHead
        title={state?.title || t("Untitled site")}
        sub={`${siteId.slice(0, 12)}…`}
        action={
          viewUrl ? (
            <a className={cx(FOCUS, "rounded-sm text-[14px] underline underline-offset-2")} href={viewUrl} target="_blank" rel="noreferrer">
              {t("Open the public page")}
            </a>
          ) : null
        }
        todo={t("Add a block and it appears. Each add or removal is one edit, signed by the site's key.")}
      />
      <div className="max-w-[56rem] space-y-5 px-4 pb-6 md:px-5">
        <p className="text-[14px]">
          {verdict?.ok ? (
            <Badge tone="ok">{t("Checked in this tab: {n} edits, every signature and link valid", { n: verdict.count })}</Badge>
          ) : verdict ? (
            <Badge tone="bad">{t("This site's chain doesn't check: edit {n}: {why}", { n: verdict.at, why: verdict.reason })}</Badge>
          ) : (
            <span className="text-[#5d646d]">…</span>
          )}
        </p>

        <fieldset className="space-y-2 rounded-md border border-[#e3e5e8] p-3">
          <legend className="px-1 text-[14px] font-semibold">{t("Title, language and look")}</legend>
          <Input label={t("Title")} value={title} onChange={setTitle} />
          <div className="flex flex-wrap gap-3 text-[14px]">
            <label>
              {t("Language")}{" "}
              <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className={cx(FOCUS, "rounded border border-[#c9ced4] px-1 py-1")}>
                <option value="en">English</option>
                <option value="ja">日本語</option>
                <option value="zh-HK">繁體中文（香港）</option>
              </select>
            </label>
            <label>
              {t("Look")}{" "}
              <select value={template} onChange={(e) => setTemplate(e.target.value as Template)} className={cx(FOCUS, "rounded border border-[#c9ced4] px-1 py-1")}>
                {TEMPLATES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button kind="secondary" disabled={busy || !title.trim()} onClick={() => void save({ op: "meta", title: title.trim(), lang, template })}>
            {t("Save title, language and look")}
          </Button>
        </fieldset>

        <fieldset className="space-y-2 rounded-md border border-[#e3e5e8] p-3">
          <legend className="px-1 text-[14px] font-semibold">{t("Add a block")}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("Block type")}>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => {
                  setKind(k);
                  setA("");
                  setB("");
                  setImage(null);
                }}
                className={cx(FOCUS, "rounded-md border px-2.5 py-1 text-[14px]", kind === k ? "border-[#1c1f23] bg-[#1c1f23] text-white" : "border-[#c9ced4]")}
              >
                {t(k)}
              </button>
            ))}
          </div>
          {kind === "heading" ? (
            <>
              <div className="flex gap-2 text-[14px]">
                {([1, 2, 3] as const).map((l) => (
                  <Toggle key={l} on={level === l} onChange={() => setLevel(l)}>
                    {`H${l}`}
                  </Toggle>
                ))}
              </div>
              <Input label={t("Heading")} value={a} onChange={setA} />
            </>
          ) : kind === "text" ? (
            <TextArea label={t("Text")} value={a} onChange={setA} rows={5} placeholder={t("Paragraphs. **bold**, *italic*, [a link](https://…)")} />
          ) : kind === "image" ? (
            <>
              <input type="file" accept={IMAGE_MIMES.join(",")} aria-label={t("Image")} onChange={(e) => void onImage(e.target.files?.[0])} className="block text-[14px]" />
              <Input label={t("Describe the image (for people who can't see it)")} value={b} onChange={(v) => {
                setB(v);
                if (image && image.type === "image") setImage({ ...image, alt: v });
              }} />
            </>
          ) : kind === "list" ? (
            <>
              <TextArea label={t("Items, one per line")} value={a} onChange={setA} rows={4} />
              <Toggle on={ordered} onChange={setOrdered}>
                {t("numbered")}
              </Toggle>
            </>
          ) : kind === "quote" ? (
            <>
              <TextArea label={t("Quote")} value={a} onChange={setA} rows={3} />
              <Input label={t("Who said it (optional; not checked)")} value={b} onChange={setB} />
            </>
          ) : (
            <>
              <Input label={t("Link (https://…)")} value={a} onChange={setA} />
              <Input label={t("Label")} value={b} onChange={setB} />
            </>
          )}
          <Button
            disabled={busy || !block}
            onClick={() =>
              void save({ op: "add", block }).then((ok) => {
                if (ok) {
                  setA("");
                  setB("");
                  setImage(null);
                }
              })
            }
          >
            {busy ? t("Signing and saving…") : t("Add")}
          </Button>
        </fieldset>

        {state && state.blocks.length ? (
          <div>
            <h3 className="mb-1 text-[15px] font-semibold">{t("Blocks")}</h3>
            <ol className="space-y-1 text-[14px]">
              {state.blocks.map((bl, i) => (
                <li key={i} className="flex items-center gap-2 border-b border-[#eceef1] py-1">
                  <span className={cx(MONO, "w-16 shrink-0 text-[#5d646d]")}>{t(bl.type)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {bl.type === "image" ? bl.alt || bl.sha256.slice(0, 16) : bl.type === "list" ? bl.items.join(" · ") : bl.type === "link" ? bl.label : bl.text}
                  </span>
                  <Button kind="quiet" disabled={busy} onClick={() => void save({ op: "remove", index: i })}>
                    {t("Remove")}
                  </Button>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {html ? (
          <div className="space-y-2">
            <h3 className="text-[15px] font-semibold">{t("Preview: exactly what readers get")}</h3>
            <iframe title={t("Preview")} sandbox="" srcDoc={html} className="h-[28rem] w-full rounded-md border border-[#e3e5e8] bg-white" />
            <div className="flex flex-wrap gap-2">
              <Button kind="secondary" onClick={() => download(`site-${siteId.slice(0, 12)}.html`, html, "text/html")}>
                {t("Export the page (.html)")}
              </Button>
              <Button kind="secondary" onClick={() => download(`site-${siteId.slice(0, 12)}.site.json`, JSON.stringify({ site: siteId, edits }, null, 1), "application/json")}>
                {t("Export the signed chain (.site.json)")}
              </Button>
            </div>
            <p className="text-[13px] text-[#5d646d]">{t("Host the .html anywhere. With the .site.json, anyone can re-check every signature and re-render the same page.")}</p>
          </div>
        ) : null}
        {err ? <p className="text-[14px] text-[#8a1f1f]">{err}</p> : null}
      </div>
    </section>
  );
}
