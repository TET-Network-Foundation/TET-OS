"use client";

/**
 * The welcome grant (lib/grants.ts; docs/plans/TESTNET_REWARDS.md): 100 TET (practice unit, can't be
 * exchanged for money) for the opening 1,000 people, claimed with a membership proof. Shown only when
 * the node has grants on. Says plainly that "one per person" is weak today.
 */
import { useEffect, useState } from "react";
import { claimWelcome, grantsStatus, type ClaimState, type GrantsStatus } from "../lib/grants";
import { formatTet } from "../lib/format_tet";
import { Button } from "./ui";
import { BASE, PROVER_URL, useTryWallet } from "./wallet";
import { useLang } from "./i18n";

export default function GrantsBox() {
  const { t } = useLang();
  const { wallet, anon, joinAnon, prover } = useTryWallet();
  const [status, setStatus] = useState<GrantsStatus>(null);
  const [claim, setClaim] = useState<ClaimState | null>(null);
  useEffect(() => {
    let on = true;
    void grantsStatus(BASE).then((s) => on && setStatus(s));
    return () => {
      on = false;
    };
  }, [claim]);
  if (!status || !wallet) return null;
  const amount = formatTet(status.amountMicro);
  const busy = claim && ["loading_set", "proving", "depositing", "sending"].includes(claim.state);
  return (
    <div className="mt-2 space-y-1 text-left text-[13.5px] text-[#5d646d]">
      <p>
        {t("Welcome grant: {amount} TET (practice unit, can't be exchanged for money) for the opening {cap} people. {n} granted so far.", { amount, cap: status.cap, n: status.granted })}
      </p>
      <p>{t("One per person, decided weakly for now: one per registration in the anonymity set, and registering is free. It moves to vouched members once Shelter's vouches exist.")}</p>
      {claim?.state === "granted" ? (
        <p className="text-[#1e6b35]">{t("Granted: {amount} TET (practice unit, can't be exchanged for money) to this ID.", { amount })}</p>
      ) : !anon?.member ? (
        <Button kind="secondary" className="min-h-9 px-3 text-[13.5px]" onClick={() => void joinAnon()}>
          {t("Join the anonymity set first")}
        </Button>
      ) : (
        <Button
          kind="secondary"
          className="min-h-9 px-3 text-[13.5px]"
          disabled={!!busy || prover === "missing" || status.granted >= status.cap}
          onClick={() => void claimWelcome(BASE, PROVER_URL, wallet.walletId, setClaim)}
        >
          {busy ? t("Proving on your computer (about 30 s)…") : t("Claim the welcome grant")}
        </Button>
      )}
      {claim?.state === "failed" ? <p className="text-[#9a1c1c]">{claim.reason}</p> : null}
      {claim?.state === "not_in_set" ? <p>{t("Your registration takes effect at the next epoch; try again in a minute.")}</p> : null}
      {prover === "missing" ? <p>{t("Claiming needs the native prover on your own computer.")}</p> : null}
    </div>
  );
}
