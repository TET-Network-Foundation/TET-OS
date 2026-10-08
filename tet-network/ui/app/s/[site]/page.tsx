"use client";

/**
 * A signed site, for readers: `/s/<site wallet id>`. The page fetches the site's edit chain from
 * this node, checks every edit's signatures and links in the reader's own tab, and only then shows
 * the rendered page, in a frame that can't run scripts (the page also carries a script-forbidding
 * CSP). The bar above says what was checked, and what that proves and doesn't.
 */
import { use, useEffect, useState } from "react";
import { applyEdits, render } from "../../lib/site_lang";
import { fetchSite, verifyChain, type ChainVerdict } from "../../lib/site_store";
import { expectedChainBinding } from "../../lib/chain_binding";
import { mldsa44Verify } from "../../lib/pqc";
import { LangProvider, useLang } from "../../try/i18n";
import { BASE } from "../../try/wallet";

function SiteView(props: { site: string }) {
  const { t } = useLang();
  const site = props.site.toLowerCase();
  const [html, setHtml] = useState("");
  const [verdict, setVerdict] = useState<ChainVerdict | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let on = true;
    void (async () => {
      try {
        if (!/^[0-9a-f]{64}$/.test(site)) throw new Error(t("That isn't a site address."));
        const got = await fetchSite(BASE, site);
        if (!got || got.edits.length === 0) throw new Error(t("This node has no site at this address (sites expire 30 days after their last edit)."));
        const v = await verifyChain(site, got.edits, await expectedChainBinding(BASE), mldsa44Verify);
        if (!on) return;
        setVerdict(v);
        if (v.ok) setHtml(render(applyEdits(got.edits.map((e) => e.body)), site, v.version));
      } catch (e: unknown) {
        if (on) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      on = false;
    };
  }, [site, t]);

  return (
    <div className="try-root flex min-h-screen flex-col bg-white text-[#1c1f23] [font-family:ui-sans-serif,system-ui,sans-serif]">
      <div className="border-b border-[#e3e5e8] bg-[#fafbfc] px-4 py-2 text-[13px] text-[#3d434a]">
        {err ? (
          <span className="text-[#8a1f1f]">{err}</span>
        ) : !verdict ? (
          t("Checking this site's signatures in your tab…")
        ) : verdict.ok ? (
          <>
            <span className="font-semibold text-[#1f5132]">{t("Signed site · checked in your tab")}</span> ·{" "}
            {t("{n} edits, every signature and link valid", { n: verdict.count })} · <span className="font-mono">{t("version")} {verdict.version.slice(0, 12)}</span> ·{" "}
            {t("Proves this site's key published every block, in this order. Not who holds the key.")}{" "}
            <a className="underline" href="/try">
              {t("What is TET?")}
            </a>
          </>
        ) : (
          <span className="text-[#8a1f1f]">{t("This site's chain doesn't check (edit {n}: {why}). Not showing it.", { n: verdict.at, why: verdict.reason })}</span>
        )}
      </div>
      {html ? <iframe title={t("Signed site")} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={html} className="w-full flex-1 border-0" /> : null}
    </div>
  );
}

export default function SitePage(props: { params: Promise<{ site: string }> }) {
  const { site } = use(props.params);
  return (
    <LangProvider>
      <SiteView site={site} />
    </LangProvider>
  );
}
