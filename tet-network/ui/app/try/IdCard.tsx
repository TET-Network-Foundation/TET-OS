"use client";

import { useState } from "react";
import { groupedId } from "../lib/shelter";
import { qrSvgPath } from "../lib/tet_qr";
import { useLang } from "./i18n";
import { Button, MONO, cx } from "./ui";

/**
 * A wallet ID in full: the 64-hex ID, copy, QR, and (for a post's verified signer) "Send DM".
 * `walletId` must be a full verified key (lib/dm_target.ts), never a short ID from the screen.
 */
export function IdCard(props: { walletId: string; onDm?: (walletId: string) => void; onClose?: () => void }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const { size, d } = qrSvgPath(props.walletId);
  return (
    <div role="dialog" aria-label={t("ID card")} className="mt-2 max-w-sm space-y-3 rounded-md border border-[#d5d9de] bg-white p-3 text-[14px] shadow-sm">
      <p translate="no" data-id-card={props.walletId} className={cx(MONO, "break-words text-[13.5px]")}>
        {groupedId(props.walletId)}
      </p>
      <svg viewBox={`0 0 ${size} ${size}`} width="160" height="160" shape-rendering="crispEdges" className="bg-white" role="img" aria-label={t("QR code of this ID")}>
        <path d={d} fill="#000" />
      </svg>
      <div className="flex flex-wrap gap-2">
        <Button
          kind="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(props.walletId).then(() => setCopied(true));
          }}
        >
          {copied ? t("Copied") : t("Copy ID")}
        </Button>
        {props.onDm ? (
          <Button kind="secondary" onClick={() => props.onDm?.(props.walletId)}>
            {t("Send DM")}
          </Button>
        ) : null}
        {props.onClose ? (
          <Button kind="secondary" onClick={props.onClose}>
            {t("Close")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
