"use client";

export interface TitleBarProps {
  /** Version label, e.g. "tet-core v0.1". */
  version: string;
  /** Tooltip for the Whitepaper button (full whitepaper title). */
  whitepaperTitle: string;
  /** Opens the "Whitepaper.txt - Notepad" window. */
  onWhitepaperOpen: () => void;
  /** Show the Lock Wallet button (only when the wallet session is ready). */
  showLockWallet: boolean;
  /** Locks the in-app wallet session. */
  onLockWallet: () => void;
}

/**
 * Navy OS title bar (version label + Whitepaper.txt + Lock Wallet) of the OS shell.
 * Extracted verbatim from `OsClient.tsx` (UI Polish Step 10); display-only — all
 * behavior is injected via callbacks.
 *
 * Note: the active-title-bar navy `#000080` / button `#000060` chrome has no
 * `tokens.ts` class equivalent (tokens carry the palette, not these Tailwind
 * strings), so the original class strings are kept verbatim to preserve pixel
 * fidelity (same approach as `StatusBar`).
 */
export default function TitleBar({
  version,
  whitepaperTitle,
  onWhitepaperOpen,
  showLockWallet,
  onLockWallet,
}: TitleBarProps) {
  return (
    <div className="bg-[#000080] text-white px-2 py-1 text-sm font-bold [text-rendering:optimizeSpeed] [-webkit-font-smoothing:auto] flex items-center gap-2">
      <span>{version}</span>
      <button
        type="button"
        title={whitepaperTitle}
        onClick={onWhitepaperOpen}
        className="ml-1 rounded-sm border border-white/40 bg-[#000060] px-1.5 py-0.5 text-xs font-mono hover:bg-[#101878]"
      >
        Whitepaper.txt
      </button>
      <span className="flex-1" aria-hidden="true" />
      {showLockWallet ? (
        <button
          type="button"
          onClick={onLockWallet}
          className="rounded-sm border border-white/40 bg-[#000060] px-2 py-0.5 text-xs font-mono hover:bg-[#101878] shrink-0"
        >
          Lock Wallet
        </button>
      ) : null}
    </div>
  );
}
