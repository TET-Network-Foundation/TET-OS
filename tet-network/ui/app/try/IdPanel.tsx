"use client";

/**
 * "My ID": this tab's ID in one place — the full ID with copy and QR, its testnet balance, keeping
 * it (save the passphrase), and the welcome grant. The header shows only the short ID, which links
 * here; nothing of this follows the visitor to other tabs.
 */

import { useEffect, useState } from "react";
import { formatTet } from "../lib/format_tet";
import { wordsFileText } from "../lib/disposable_wallet.mjs";
import GrantsBox from "./GrantsBox";
import { IdCard } from "./IdCard";
import { useLang } from "./i18n";
import { Button, FOCUS, PanelHead, cx } from "./ui";
import { useTryWallet } from "./wallet";

export default function IdPanel(props: { baseUrl: string; active: boolean }) {
  const { t } = useLang();
  const { wallet, ensureWallet } = useTryWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Read only while this tab is open.
  useEffect(() => {
    if (!props.active || !wallet) return;
    let on = true;
    void fetch(`${props.baseUrl}/ledger/balance/${wallet.walletId}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ balance_micro_tet?: number }>) : null))
      .then((j) => on && j && setBalance(formatTet(j.balance_micro_tet ?? 0)))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [props.active, props.baseUrl, wallet]);

  const head = <PanelHead title={t("My ID")} todo={t("This tab's ID: copy it, show its QR code, keep it.")} />;
  if (!wallet) {
    return (
      <section aria-label={t("My ID")}>
        {head}
        <div className="max-w-[44rem] space-y-3 px-4 pb-8 pt-3 md:px-5">
          <p className="text-[15px]">{t("This tab has no ID yet.")}</p>
          <Button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void ensureWallet().finally(() => setBusy(false));
            }}
          >
            {t("Make my ID")}
          </Button>
        </div>
      </section>
    );
  }
  const save = () => {
    const url = URL.createObjectURL(new Blob([wordsFileText(wallet.words, wallet.walletId)], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tet-testnet-wallet-${wallet.walletId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section aria-label={t("My ID")}>
      {head}
      <div className="max-w-[44rem] space-y-4 px-4 pb-8 pt-3 text-[15px] md:px-5">
        <IdCard walletId={wallet.walletId} />
        {balance !== null ? <p>{t("{amount} TET (practice unit, can't be exchanged for money)", { amount: balance })}</p> : null}
        <div className="space-y-1">
          <button type="button" className={cx(FOCUS, "rounded-sm underline underline-offset-2")} onClick={save}>
            {t("Keep this ID? Save your passphrase (12 words)")}
          </button>
          <p className="text-[14px] text-[#5d646d]">
            {t("Lose your passphrase (12 words) and nobody can recover it.")} {t("TET asks for your passphrase (12 words) only on the restore screen; support never DMs you.")}
          </p>
        </div>
        <GrantsBox />
      </div>
    </section>
  );
}
