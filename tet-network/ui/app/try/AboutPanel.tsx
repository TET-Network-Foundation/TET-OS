"use client";

/** About: what TET is, who runs it, how to reach them. Plain text, no claims beyond what is built. */
import { MONO, PanelHead, cx } from "./ui";
import { useLang } from "./i18n";
import { ABUSE_CONTACT } from "./TermsPanel";

const REPO = "https://github.com/TET-Network-Foundation/TET-OS";

export default function AboutPanel() {
  const { t } = useLang();
  const link = (href: string, label: string) => (
    <a className="underline" href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
  return (
    <section aria-label={t("About")}>
      <PanelHead title={t("About")} todo={t("What TET is, who runs it, and how to reach them.")} />
      <div className="max-w-[40rem] space-y-5 px-4 py-4 text-base leading-relaxed md:px-5">
        <div className="flex items-center gap-3">
          {/* The TET logo: the founder's design, traced exactly (public/brand/tet-logo.svg). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/tet-logo.svg" width={56} height={56} alt={t("TET logo")} className="tet-logo h-14 w-14" />
          <p className="text-[15px] font-semibold">TET v0.2 · testnet</p>
        </div>
        <div>
          <h3 className="mb-1 text-[15px] font-semibold">{t("What TET is")}</h3>
          <ol className="list-decimal space-y-1 pl-5">
            <li>{t("TET is a blockchain meant to stay secure once quantum computers can break today's signatures. Every transaction is signed twice, with Ed25519 and with ML-DSA-44; until the Phase 1 genesis binds the ML-DSA key to the wallet, that protection is incomplete.")}</li>
            <li>{t("On top of it run Tmail (end-to-end encrypted messages and files) and boards where you can post anonymously with a zero-knowledge proof.")}</li>
            <li>{t("It is a testnet: the coins have no value, and the network is a handful of nodes.")}</li>
            <li>{t("The code is open source. None of it has been audited yet, and binding both keys to one wallet id is still Phase 1 work.")}</li>
            <li>{t("This page talks to one demo node. You can run your own node and point the desktop app at it.")}</li>
          </ol>
        </div>
        <div>
          <h3 className="mb-1 text-[15px] font-semibold">{t("Who runs it")}</h3>
          <p>{t("TET is built by Steve.")}</p>
        </div>
        <div>
          <h3 className="mb-1 text-[15px] font-semibold">{t("Contact")}</h3>
          <p>
            <a className={cx(MONO, "text-[15px] underline")} href="mailto:tetsteve@proton.me">
              tetsteve@proton.me
            </a>
          </p>
          <p className="mt-1 text-[15px] text-[#3d434a]">{t("To report a security problem, follow SECURITY.md rather than posting it on a board.")}</p>
          <p className="mt-3">
            {t("To report content:")}{" "}
            <a className={cx(MONO, "text-[15px] underline")} href={`mailto:${ABUSE_CONTACT}`}>
              {ABUSE_CONTACT}
            </a>
          </p>
          <p className="mt-1 text-[15px] text-[#3d434a]">{t("Reports are reviewed within 48 hours.")}</p>
        </div>
        <div>
          <h3 className="mb-1 text-[15px] font-semibold">{t("Links")}</h3>
          <ul className="space-y-1">
            <li>{link("https://stevenexus.org", "stevenexus.org")}</li>
            <li>{link(REPO, t("GitHub (source code)"))}</li>
            <li>{link(`${REPO}/blob/main/SECURITY.md`, "SECURITY.md")}</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
