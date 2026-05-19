/** GET /ledger/state — matches tet-core `rest/handlers/ledger.rs` + `sync::SyncStatusInfo`. */

export type LedgerSyncInProgress = {
  peer_id: string;
  from_height: number;
  to_height: number;
};

export type LedgerSyncStatus = {
  active: boolean;
  lag_blocks: number;
  best_peer_id: string;
  best_peer_height: number;
  in_progress_request: LedgerSyncInProgress | null;
};

export type LedgerState = {
  block_height: number;
  state_root: string;
  mempool_len: number;
  synced: boolean;
  sync: LedgerSyncStatus;
};

export type SyncUiKind =
  | "connecting"
  | "offline"
  | "live"
  | "syncing"
  | "catching_up"
  | "awaiting_peers"
  | "not_synced";

export type SyncUiState = {
  kind: SyncUiKind;
  /** Status bar primary badge, e.g. `● LIVE` */
  badgeText: string;
  badgeClass: string;
  dotClass: string;
  /** Right status strip, e.g. `(Synced)` */
  shortLabel: string;
  /** Supply panel subtitle */
  pollingHint: string;
  panelGreenTint: boolean;
  detailLines: string[];
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseInProgress(raw: unknown): LedgerSyncInProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const fromH = num(o.from ?? o.from_height);
  const toH = num(o.to ?? o.to_height);
  if (fromH == null || toH == null) return null;
  return {
    peer_id: str(o.peer_id),
    from_height: fromH,
    to_height: toH,
  };
}

/** Safe parse of `/ledger/state` JSON (snake_case). */
export function parseLedgerState(raw: unknown): LedgerState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const syncRaw = o.sync;
  if (!syncRaw || typeof syncRaw !== "object") return null;
  const s = syncRaw as Record<string, unknown>;
  const blockHeight = num(o.block_height);
  if (blockHeight == null) return null;
  return {
    block_height: blockHeight,
    state_root: str(o.state_root),
    mempool_len: num(o.mempool_len) ?? 0,
    synced: o.synced === true,
    sync: {
      active: s.active === true,
      lag_blocks: num(s.lag_blocks) ?? 0,
      best_peer_id: str(s.best_peer_id),
      best_peer_height: num(s.best_peer_height) ?? 0,
      in_progress_request: parseInProgress(s.in_progress_request),
    },
  };
}

export function truncatePeerId(peerId: string): string {
  const t = peerId.trim();
  if (!t) return "—";
  if (t.length <= 16) return t;
  return `${t.slice(0, 12)}…`;
}

/** Display rules for Sovereign OS status chrome (English). */
export function deriveSyncUi(
  state: LedgerState | null,
  opts: { offline: boolean; connecting: boolean },
): SyncUiState {
  if (opts.connecting && !opts.offline && !state) {
    return {
      kind: "connecting",
      badgeText: "● CONNECTING",
      badgeClass: "text-black/70 font-semibold",
      dotClass: "mr-2 inline-block h-2 w-2 rounded-full bg-[#808080] animate-pulse",
      shortLabel: "(Connecting…)",
      pollingHint: "connecting to tet-core",
      panelGreenTint: false,
      detailLines: [],
    };
  }

  if (opts.offline || !state) {
    return {
      kind: "offline",
      badgeText: "● OFFLINE",
      badgeClass: "text-red-700 font-semibold",
      dotClass: "mr-2 inline-block h-2 w-2 rounded-full bg-[#c1121f]",
      shortLabel: "(Offline)",
      pollingHint: "waiting for tet-core",
      panelGreenTint: false,
      detailLines: [],
    };
  }

  const { synced, sync } = state;
  const lag = sync.lag_blocks;
  const hasPeer = sync.best_peer_id.trim().length > 0;
  const detailLines: string[] = [];

  if (hasPeer) {
    detailLines.push(
      `Peer: ${truncatePeerId(sync.best_peer_id)} @ height ${sync.best_peer_height.toLocaleString("en-US")}`,
    );
  }
  const ipr = sync.in_progress_request;
  if (ipr) {
    detailLines.push(
      `Sync range: [${ipr.from_height.toLocaleString("en-US")}..${ipr.to_height.toLocaleString("en-US")}]`,
    );
  }

  const yellowBadge = "text-[#8a6d00] font-semibold";
  const yellowDot = "mr-2 inline-block h-2 w-2 rounded-full bg-[#c9a227] animate-pulse";

  if (synced && !sync.active) {
    return {
      kind: "live",
      badgeText: "● LIVE",
      badgeClass: "text-[#0b5c2e] font-semibold",
      dotClass: "mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[#00a651]",
      shortLabel: "(Synced)",
      pollingHint: "live polling",
      panelGreenTint: true,
      detailLines,
    };
  }

  if (!synced && sync.active) {
    return {
      kind: "syncing",
      badgeText: `● Syncing… (lag: ${lag.toLocaleString("en-US")})`,
      badgeClass: yellowBadge,
      dotClass: yellowDot,
      shortLabel: `(Syncing, lag ${lag.toLocaleString("en-US")})`,
      pollingHint: "catch-up in progress",
      panelGreenTint: false,
      detailLines,
    };
  }

  if (!synced && !hasPeer) {
    return {
      kind: "awaiting_peers",
      badgeText: "● Awaiting peers",
      badgeClass: "text-black/55 font-semibold",
      dotClass: "mr-2 inline-block h-2 w-2 rounded-full bg-[#808080]",
      shortLabel: "(Awaiting peers)",
      pollingHint: "no block-plane peer yet",
      panelGreenTint: false,
      detailLines,
    };
  }

  if (!synced && !sync.active && lag > 0) {
    return {
      kind: "catching_up",
      badgeText: `● Catching up (lag: ${lag.toLocaleString("en-US")})`,
      badgeClass: yellowBadge,
      dotClass: yellowDot,
      shortLabel: `(Catching up, lag ${lag.toLocaleString("en-US")})`,
      pollingHint: "behind best peer",
      panelGreenTint: false,
      detailLines,
    };
  }

  if (!synced) {
    return {
      kind: "not_synced",
      badgeText: lag > 0 ? `● Not synced (lag: ${lag.toLocaleString("en-US")})` : "● Not synced",
      badgeClass: yellowBadge,
      dotClass: yellowDot,
      shortLabel: lag > 0 ? `(Not synced, lag ${lag.toLocaleString("en-US")})` : "(Not synced)",
      pollingHint: "sync gate closed",
      panelGreenTint: false,
      detailLines,
    };
  }

  // synced=true but catch-up driver still active — show syncing, not LIVE
  return {
    kind: "syncing",
    badgeText: `● Syncing… (lag: ${lag.toLocaleString("en-US")})`,
    badgeClass: yellowBadge,
    dotClass: yellowDot,
    shortLabel: `(Syncing, lag ${lag.toLocaleString("en-US")})`,
    pollingHint: "catch-up in progress",
    panelGreenTint: false,
    detailLines,
  };
}
