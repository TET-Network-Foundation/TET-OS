"use client";

/**
 * Terms for the Try TET demo: short, plain, and only what the node actually does. The hide command
 * it describes is tet-core's operator route (`POST /operator/hide`): node-local, logged, and it
 * never touches chain data.
 */
import { MONO, PanelHead, cx } from "./ui";
import { useLang } from "./i18n";

export const ABUSE_CONTACT = "abuse@stevenexus.org";

export default function TermsPanel() {
  const { t } = useLang();
  return (
    <section aria-label={t("Terms")}>
      <PanelHead title={t("Terms")} todo={t("Short rules for using this demo node.")} />
      <div className="max-w-[40rem] space-y-5 px-4 py-4 text-base leading-relaxed md:px-5">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>{t("This is a testnet run by one person. The coins have no value and the chain can be reset. It comes with no warranty.")}</li>
          <li>{t("Don't post anything illegal.")}</li>
          <li>{t("Don't post copyrighted material you don't own or have the right to share.")}</li>
          <li>{t("The operator may hide any board, thread, post or file from this node's public API. Hiding never deletes chain data, and copies other nodes already hold stay on those nodes.")}</li>
          <li>{t("Every hide is written to the operator's own log.")}</li>
          <li>{t("Posts, messages and files expire: after 7 days by default, 30 at most. The chain itself holds fees and hashes, not what you wrote.")}</li>
          <li>{t("Marks (proof codes) and sealed predictions hold only a fingerprint and your ID, never the content. They're kept on this node, and the operator can hide them like anything else.")}</li>
        </ol>
        <div>
          <h3 className="mb-1 text-[15px] font-semibold">{t("Report content")}</h3>
          <p>
            <a className={cx(MONO, "text-[15px] underline")} href={`mailto:${ABUSE_CONTACT}`}>
              {ABUSE_CONTACT}
            </a>
          </p>
          <p className="mt-1 text-[15px] text-[#3d434a]">{t("Reports are reviewed within 48 hours. Include the board's invite link or the post's number, and what is wrong with it.")}</p>
        </div>
      </div>
    </section>
  );
}
