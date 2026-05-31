"use client";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/static-components, @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { cryptoWaitReady, mnemonicValidate } from "@polkadot/util-crypto";
import { mnemonicToTetEd25519Keypair, signTetEd25519 } from "../lib/ed25519_tet";
import { stringToU8a } from "@polkadot/util";
import { clearSession, loadSession } from "../lib/session";
import { loadAddressBook, saveAddressBook, type AddressBookEntryV0 } from "../lib/address_book_store";
import { loadTxs, saveTxs, type TxRowV0, type TxType } from "../lib/tx_store";
import { clearWalletStore, loadWalletStore, sha256Hex } from "../lib/wallet_store";
import { deriveSyncUi, type LedgerState, type SyncUiState } from "../lib/ledger_state";
import {
  type ExplorerTxJson,
  type LedgerBlockDetailJson,
  fetchExplorerTx,
  fetchJson,
  fetchLedgerBlock,
  fetchLedgerBlocks,
  fetchLedgerState,
  fetchMarketTotalSupplyMicro,
  fetchNetworkStatsMicro,
  getLedgerMeBalanceMicro,
  getLedgerMeWalletInferenceBurnMicro,
  getVisionCaacProfile,
  getVisionNetworkConfig,
  getTmailInbox,
  getTmailKeys,
  getVisionPqcStatus,
  getWorkerStats,
  normalizeWalletId64,
  postEnterpriseInference,
  postInitialAirdropClaim,
  postTmailSend,
  postWalletTransfer,
  putTmailKeys,
  STEVEMON_PER_TET,
  tetCoreUrl,
} from "../lib/tet_core_http";
import {
  buildTransferEnvelope,
  userFacingTransferError,
} from "../lib/transfer";
import {
  buildTmailEnvelopeV1,
  buildTmailKeyRegistrationV1,
  decryptTmailEnvelope,
  type TmailEnvelopeV1,
} from "../lib/tmail";
import { deriveTmailKeysFromMnemonic, type TmailKemKeys } from "../lib/tmail_keys";
import { b64ToBytes } from "../lib/encoding";
import { fetchWorkerCockpit, microTetToTet, type WorkerCockpitJson } from "../lib/worker_cockpit";
import { GENESIS_FOUNDER_WALLET_ID_HEX } from "../lib/genesis_wallet";
import {
  changeInAppWalletPin,
  createInAppWalletWithMnemonic,
  generateMnemonic12Polkadot,
  isValidWalletPin,
  readInAppWalletRecord,
  unlockInAppWallet,
} from "../lib/inapp_wallet";
import { setHybridSignerSession, getHybridSignerSession } from "../lib/hybrid_signer_session";
import { mldsa44KeypairFromMnemonic, pqcInit } from "../lib/pqc";
import { unlockVault } from "../lib/pin_vault";
import type { OsWalletStorageKind } from "../lib/wallet_bootstrap";
import { detectOsWalletStorageKind } from "../lib/wallet_bootstrap";
import { TET_WHITEPAPER_FULL_TEXT, TET_WHITEPAPER_TITLE } from "../lib/tetWhitepaper";
import {
  filterInboxMessagesForRecipient,
  normalizePubkeyHex,
  useIncomingMessages,
} from "../lib/useIncomingMessages";

type TabId =
  | "Transactions"
  | "Send Coins"
  | "Inbox / Receive"
  | "Messages"
  | "Address Book"
  | "AI Task Terminal"
  | "Explorer"
  | "Worker";

/** A received Tmail envelope after client-side E2EE decryption (newest-first in the UI). */
type DecryptedTmail = {
  msgId: string;
  sender: string;
  sentAtMs: number;
  plaintext: string;
};
type MenuId = "File" | "Options" | "Help" | null;
type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  status?: "queued" | "error";
};

/** Matches `pallet_tet_core` `AiPromptMaxLen` (2048). */
const AI_PROMPT_MAX_BYTES = 2048;

/** Client-side FLOPs hint for §4.2 estimate API (aligns with tet-core worker default order of magnitude). */
const VISION_EST_FLOPS_PER_TOKEN = 1_000_000;

/**
 * Heuristic c_flops for vision infer estimate: tokens = max(1, ⌊chars/4⌋), FLOPs = tokens × 1e6.
 */
function estimateVisionInferFlopsFromPromptChars(charCount: number): bigint {
  const tokens = Math.max(1, Math.floor(charCount / 4));
  return BigInt(tokens) * BigInt(VISION_EST_FLOPS_PER_TOKEN);
}

/** Display-only escrow line + ledger log; matches tet-core local `POST /ai/infer` charge (10 Stevemon ≈ 0.00001 TET). */
const AI_TASK_DISPLAY_ESCROW_MICRO = 10n;
const TX_HISTORY_STORAGE_KEY = "tetTxHistory";

function publicTetCoreUrl(): string {
  const direct =
    process.env.NEXT_PUBLIC_TET_CORE_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim();
  return direct || "/tet-node-api";
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function parseTet(s: string): bigint | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  // allow "5", "0.5", "0.00000001" (up to 8 decimals for 10^8)
  const m = t.match(/^(\d+)(?:\.(\d{1,8}))?$/);
  if (!m) return null;
  const whole = BigInt(m[1]);
  const fracRaw = (m[2] ?? "").padEnd(8, "0");
  const frac = BigInt(fracRaw || "0");
  return whole * STEVEMON_PER_TET + frac;
}
function formatStevemonToTet(stv: bigint): string {
  const whole = stv / STEVEMON_PER_TET;
  const frac = stv % STEVEMON_PER_TET;
  const fracStr = frac.toString().padStart(6, "0").slice(0, 2);
  return `${whole.toString()}.${fracStr}`;
}

function formatStevemonToTetDisplay(stv: bigint): string {
  const whole = stv / STEVEMON_PER_TET;
  const frac = stv % STEVEMON_PER_TET;
  const fracStr = frac.toString().padStart(6, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${fracStr}`;
}

function shortHash(s: string, head = 10, tail = 8): string {
  if (!s) return "—";
  if (s.length <= head + tail + 3) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function normalizeHexInput(raw: string): string {
  const s = raw.trim().toLowerCase();
  return s.startsWith("0x") ? s.slice(2) : s;
}

function formatWorkerTet(micro: number): string {
  const tet = microTetToTet(micro);
  return `${tet.toLocaleString("en-US", { maximumFractionDigits: tet >= 100 ? 2 : 6 })} TET`;
}

function formatTflops(v: number): string {
  return `${(Number.isFinite(v) ? v : 0).toLocaleString("en-US", { maximumFractionDigits: 1 })} TFLOPS`;
}

/** Stevemon → TET with full 6 fractional digits (comma whole part). Sub-cent amounts stay visible. */
function formatStevemonToTetFullDisplay(stv: bigint): string {
  const whole = stv / STEVEMON_PER_TET;
  const frac = stv % STEVEMON_PER_TET;
  const fracStr = frac.toString().padStart(6, "0");
  return `${whole.toLocaleString("en-US")}.${fracStr}`;
}

function formatStevemonToTetCompact(stv: bigint): string {
  const tet = Number(stv) / Number(STEVEMON_PER_TET);
  if (!Number.isFinite(tet)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: tet >= 1_000_000 ? 2 : 3,
  }).format(tet);
}

/** Integer math aligned with on-chain: fee = gross/100, net = gross - fee, fee split 50/50. */
function tetTransferFeeBreakdown(grossStevemon: bigint) {
  const feeTotal = grossStevemon / 100n;
  const netToRecipient = grossStevemon - feeTotal;
  const feeToFounder = feeTotal / 2n;
  const feeBurned = feeTotal - feeToFounder;
  return { feeTotal, netToRecipient, feeToFounder, feeBurned };
}

function formatStevemonDisplay(stv: bigint): string {
  return stv.toLocaleString("en-US");
}

/** Ledger `cost_micro` — default local inference matches 10 Stevemon / 0.00001 TET. */
function formatTetStringDisplay(tet: string): string {
  const stv = parseTet(tet);
  if (stv == null) return tet;
  return formatStevemonToTetDisplay(stv);
}

export default function NexusOS() {
  const router = useRouter();
  const baseUrl = useMemo(() => publicTetCoreUrl(), []);
  const middlewareUrl = useMemo(
    () => process.env.NEXT_PUBLIC_TET_MIDDLEWARE_URL?.trim() || publicTetCoreUrl(),
    [],
  );
  const outset = "border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] rounded-none";
  const inset = "border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white rounded-none";
  const face = "bg-[#D6D4CE]";
  const panel = "bg-[#DAD8D2]";
  const field = "bg-[#F9F9F6]";
  const winBtn =
    "rounded-none border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] select-none active:border-t-[#808080] active:border-l-[#808080] active:border-b-white active:border-r-white active:translate-x-px active:translate-y-px";

  const [menuOpen, setMenuOpen] = useState<MenuId>(null);
  const [tab, setTab] = useState<TabId>("AI Task Terminal");
  const [desktopViewport, setDesktopViewport] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 768px)").matches,
  );
  const menuBarRef = useRef<HTMLDivElement | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [inboxAddressCopied, setInboxAddressCopied] = useState(false);
  const [whitepaperOpen, setWhitepaperOpen] = useState(false);
  const [walletUnlockOpen, setWalletUnlockOpen] = useState(false);
  /** `init` until first localStorage scan; then `locked` until user unlocks; `ready` when hybrid session is set. */
  const [walletGate, setWalletGate] = useState<"init" | "locked" | "ready">("init");
  const [persistedWalletKind, setPersistedWalletKind] = useState<OsWalletStorageKind>("none");
  const [walletUnlockErr, setWalletUnlockErr] = useState("");
  const [walletSecretInput, setWalletSecretInput] = useState("");
  const [importMnemonicInput, setImportMnemonicInput] = useState("");
  const [importWalletPin, setImportWalletPin] = useState("");
  const [newMnemonicDraft, setNewMnemonicDraft] = useState("");
  const [newWalletPin, setNewWalletPin] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  /** One-shot UX after first successful welcome airdrop (unlock claim or first infer). */
  const [welcomeAirdropBanner, setWelcomeAirdropBanner] = useState<string | null>(null);
  const welcomeAirdropShownRef = useRef(false);

  const [pinCur, setPinCur] = useState("");
  const [pinNew, setPinNew] = useState("");
  const [pinNew2, setPinNew2] = useState("");
  const [pinErr, setPinErr] = useState<string>("");
  const [pinOk, setPinOk] = useState<string>("");
  const [bestNumber, setBestNumber] = useState<number | null>(null);
  const [ledgerState, setLedgerState] = useState<LedgerState | null>(null);
  const ledgerStateFetchedOnceRef = useRef(false);
  const [syncUi, setSyncUi] = useState<SyncUiState>(() =>
    deriveSyncUi(null, { offline: false, connecting: true }),
  );
  /** Formatted TET (Stevemon / 10^6), comma-separated whole part + 2 decimals */
  const [totalSupply, setTotalSupply] = useState<string>("—");
  /** Raw total issuance in Stevemon (10^6 per TET) for supply line */
  const [totalSupplyStevemon, setTotalSupplyStevemon] = useState<bigint | null>(null);
  /** From GET /network/stats — protocol-wide cumulative burn (THERMODYNAMIC BURN display). */
  const [networkBurnedStevemon, setNetworkBurnedStevemon] = useState<bigint | null>(null);
  /** Wallet-attributed inference burn share from GET /ledger/me `wallet_inference_burn_micro`. */
  const [walletInferenceBurnStevemon, setWalletInferenceBurnStevemon] = useState<bigint | null>(null);
  const [networkEpoch, setNetworkEpoch] = useState<number | null>(null);
  /** Worker TFLOPS aggregate from network stats (fallback: dummy scale from worker count). */
  const [networkTflops, setNetworkTflops] = useState<number | null>(null);
  /** `WALLET_SYSTEM_WORKER_POOL` balance from network stats (Stevemon micro). */
  const [workerPoolBalanceStevemon, setWorkerPoolBalanceStevemon] = useState<bigint | null>(null);
  const [latestBlocks, setLatestBlocks] = useState<
    { height: number; block_id: string; state_root?: string; tx_count: number; ts_ms?: number }[]
  >([]);
  const [lastAiDemandTaskId, setLastAiDemandTaskId] = useState<string | null>(null);
  const [lastWalletRewardDelta, setLastWalletRewardDelta] = useState<bigint | null>(null);

  const [address, setAddress] = useState<string>("—");
  /** `null` = ledger REST failed — do not treat as zero balance. */
  const [balanceStevemon, setBalanceStevemon] = useState<bigint | null>(null);
  const [statusWorkers, setStatusWorkers] = useState<number | null>(null);
  const [pqcStatusShort, setPqcStatusShort] = useState<string>("—");
  /** libp2p peer count from GET /v1/vision/network/config */
  const [connectedPeers, setConnectedPeers] = useState<number | null>(null);
  /** PQC status line for status bar (green when ML-DSA stack active). */
  const [statusSecurity, setStatusSecurity] = useState<{ label: string; active: boolean }>({
    label: "Security: —",
    active: false,
  });
  /** SS58 of the Founder signing account (fixed session). */
  const [activeAccountAddress, setActiveAccountAddress] = useState<string>("—");
  /** sr25519 public key hex for Founder. */
  /** Founder sr25519 → 64-char lowercase hex `wallet_id` for REST (no `0x`; matches ledger API). */
  const [founderWalletIdHex64, setFounderWalletIdHex64] = useState<string>("—");

  // txs + address book
  const [txs, setTxs] = useState<TxRowV0[]>([]);
  const [addrBook, setAddrBook] = useState<AddressBookEntryV0[]>([]);

  const [txHistory, setTxHistory] = useState<any[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Send Coins
  const [sendTo, setSendTo] = useState("");
  const [sendAmountTet, setSendAmountTet] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sendingTx, setSendingTx] = useState(false);
  const [sendTransferPhase, setSendTransferPhase] = useState<
    "idle" | "signing" | "submitting" | "pending" | "confirmed" | "failed"
  >("idle");
  const [sendTransferUserMsg, setSendTransferUserMsg] = useState<string>("");
  const [isSignerReady, setIsSignerReady] = useState(false);

  // Messages (Tmail Basic E2EE) — KEM keys are derived locally from the mnemonic on unlock.
  const [tmailKeys, setTmailKeys] = useState<TmailKemKeys | null>(null);
  const tmailKeysRef = useRef<TmailKemKeys | null>(null);
  const [tmailRecipient, setTmailRecipient] = useState("");
  const [tmailBody, setTmailBody] = useState("");
  const [tmailSending, setTmailSending] = useState(false);
  const [tmailComposeMsg, setTmailComposeMsg] = useState("");
  const [tmailInbox, setTmailInbox] = useState<DecryptedTmail[]>([]);
  const [tmailShowAll, setTmailShowAll] = useState(false);
  const [tmailKeysRegisteredAtMs, setTmailKeysRegisteredAtMs] = useState<number | null>(null);
  const [tmailKeyStatus, setTmailKeyStatus] = useState<
    "unknown" | "registering" | "registered" | "unregistered" | "error"
  >("unknown");
  /** Guards the one-shot auto-register per wallet (keyed by wallet_id). */
  const tmailAutoRegisteredRef = useRef<string>("");

  const TMAIL_BODY_MAX = 4096;
  const TMAIL_INBOX_VISIBLE = 5;

  const MIN_SEND_MICRO = 1_000n; // 0.001 TET

  /** On-chain `requestAiInference` (escrow lock); reward auto-sized from prompt length. */
  const [aiTaskPrompt, setAiTaskPrompt] = useState("");
  const [aiTaskSubmitting, setAiTaskSubmitting] = useState(false);
  const [aiChatMessages, setAiChatMessages] = useState<AiChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      ts: 0,
      text: "Ask anything. TET-Network will route your prompt through decentralized compute and settle the work on L1.",
    },
  ]);
  const aiChatScrollRef = useRef<HTMLDivElement | null>(null);
  const [visionCaacRole, setVisionCaacRole] = useState<string>("syncing…");
  /** CAAC role from `GET /worker/stats/:wallet` when worker is heartbeating (ledger + registry). */
  const [networkCaacLine, setNetworkCaacLine] = useState<string>("—");
  /** AI Task strip: FLOPs heuristic + fixed local-settlement cost display (10 Stevemon, matches tet-core). */
  const [visionInferThermo, setVisionInferThermo] = useState<{
    estimatedFlops: bigint;
    totalMicro: number;
    thermodynamicRMicro: number;
    workerMicro: number;
    burnMicro: number;
  } | null>(null);

  // TET-OS Explorer window
  const [explorerQuery, setExplorerQuery] = useState("");
  const [explorerErr, setExplorerErr] = useState("");
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [explorerBlock, setExplorerBlock] = useState<LedgerBlockDetailJson | null>(null);
  const [explorerTx, setExplorerTx] = useState<ExplorerTxJson | null>(null);

  // TET-OS Worker window
  const [workerCockpit, setWorkerCockpit] = useState<WorkerCockpitJson | null>(null);
  const [workerCockpitErr, setWorkerCockpitErr] = useState("");
  const [workerCockpitLoading, setWorkerCockpitLoading] = useState(false);
  const [workerCockpitUpdatedAt, setWorkerCockpitUpdatedAt] = useState<number | null>(null);

  // Worker runtime log
  const [miningOn, setMiningOn] = useState(false);
  const [miningLog, setMiningLog] = useState<string[]>([]);

  // Global ledger (always visible)
  const [ledger, setLedger] = useState<string[]>([
    "TET Core v0.1.0",
    `core_url: ${baseUrl}`,
    "status: ready",
  ]);
  const ledgerRef = useRef<HTMLDivElement | null>(null);
  /** Dedup [THERMO] ledger lines when balance subscription fires without numeric change. */
  const lastThermoLedgerLineRef = useRef<string>("");
  const seenTransferSeqRef = useRef<Set<string>>(new Set());
  const lastLoggedLedgerSeqRef = useRef<number | null>(null);
  const previousBalanceRef = useRef<bigint | null>(null);

  /** Root-level inbox listener — must run every OS mount (not nested). */
  const { allMessages, clearInboxForRecipient } = useIncomingMessages(
    baseUrl,
    normalizePubkeyHex(founderWalletIdHex64),
  );
  const activeIdentityPubkeyNorm = useMemo(
    () => normalizePubkeyHex(founderWalletIdHex64),
    [founderWalletIdHex64],
  );
  const inboxForIdentity = useMemo(
    () => filterInboxMessagesForRecipient(allMessages, activeIdentityPubkeyNorm),
    [allMessages, activeIdentityPubkeyNorm],
  );

  useEffect(() => {
    if (!menuOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const root = menuBarRef.current;
      const t = e.target as Node | null;
      if (!root || !t) return;
      if (!root.contains(t)) setMenuOpen(null);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [menuOpen]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setDesktopViewport(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const anyModalOpen =
    aboutOpen ||
    manualOpen ||
    backupOpen ||
    changePinOpen ||
    networkOpen ||
    whitepaperOpen ||
    walletUnlockOpen;

  function closeChangePin() {
    setChangePinOpen(false);
    setPinCur("");
    setPinNew("");
    setPinNew2("");
    setPinErr("");
    setPinOk("");
  }

  async function applyChangePin() {
    setPinErr("");
    setPinOk("");
    const cur = pinCur.trim();
    const n1 = pinNew.trim();
    const n2 = pinNew2.trim();
    if (!isValidWalletPin(cur) || !isValidWalletPin(n1) || !isValidWalletPin(n2)) {
      setPinErr("PIN must be 6–8 digits.");
      return;
    }
    if (n1 !== n2) {
      setPinErr("New PIN mismatch.");
      return;
    }
    if (readInAppWalletRecord()) {
      try {
        await changeInAppWalletPin(cur, n1);
      } catch (e: unknown) {
        setPinErr(e instanceof Error ? e.message : "Invalid current PIN or wallet error.");
        return;
      }
      setPinOk("PIN Successfully Changed");
      window.setTimeout(() => closeChangePin(), 650);
      return;
    }
    const ws = loadWalletStore();
    if (!ws) {
      setPinErr("No wallet found. Create Account first.");
      return;
    }
    const hCur = await sha256Hex(cur);
    if (hCur !== ws.pin_sha256_hex) {
      setPinErr("Invalid Current PIN");
      return;
    }
    try {
      await createInAppWalletWithMnemonic(n1, ws.mnemonic12.trim());
      clearWalletStore();
    } catch (e: unknown) {
      setPinErr(e instanceof Error ? e.message : "Could not update PIN.");
      return;
    }
    setPinOk("PIN Successfully Changed");
    window.setTimeout(() => closeChangePin(), 650);
  }

  function appendLedger(lines: string[]) {
    setLedger((prev) => {
      const next = [...prev, ...lines];
      return next.length > 6000 ? next.slice(next.length - 6000) : next;
    });
    queueMicrotask(() => {
      const el = ledgerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  const triggerWelcomeAirdropNotice = useCallback(() => {
    if (welcomeAirdropShownRef.current) return;
    welcomeAirdropShownRef.current = true;
    setWelcomeAirdropBanner("Welcome Airdrop: 1,000 TET has been granted!");
  }, []);

  useEffect(() => {
    if (walletGate !== "ready") return;
    const wid = normalizeWalletId64(founderWalletIdHex64);
    if (!wid) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await postInitialAirdropClaim(baseUrl, wid);
        if (cancelled || !r.ok) return;
        // 200 already_claimed: the wallet already holds its welcome airdrop — nothing to announce.
        if (r.outcome === "already_claimed") return;
        // 202 pending: claim is queued + gossiped. Poll the tx index until a producer mines it
        // into a block, then announce. (The credit is applied by consensus, not locally.)
        if (!r.txHash) return;
        const CONFIRM_TIMEOUT_MS = 30_000;
        const POLL_INTERVAL_MS = 3_000;
        const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
        while (!cancelled && Date.now() < deadline) {
          await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
          if (cancelled) return;
          const txRes = await fetchExplorerTx(baseUrl, r.txHash);
          if (txRes.ok && txRes.data?.found) {
            if (!cancelled) triggerWelcomeAirdropNotice();
            return;
          }
        }
      } catch {
        // ignore (offline / CORS)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletGate, founderWalletIdHex64, baseUrl, triggerWelcomeAirdropNotice]);

  useEffect(() => {
    setIsSignerReady(walletGate === "ready");
  }, [walletGate]);

  async function applyUnlockedHybridSessionFromMnemonic(mnemonicNorm: string) {
    await pqcInit();
    const phrase = mnemonicNorm.trim().toLowerCase().replace(/\s+/g, " ");
    if (!mnemonicValidate(phrase)) {
      throw new Error("Invalid Mnemonic: BIP39 validation failed.");
    }
    const ed = mnemonicToTetEd25519Keypair(phrase);
    const wid = ed.walletIdHex.toLowerCase();
    const sk = ed.secretKey;
    const pqc = await mldsa44KeypairFromMnemonic(phrase);
    setHybridSignerSession({
      walletIdHex64: wid,
      signEd25519: (buf) => signTetEd25519(sk, buf),
      mldsa44_keypair_b64: pqc.keypair_b64,
      mldsa44_pubkey_b64: pqc.pubkey_b64,
      displayAddress: `${wid.slice(0, 10)}…${wid.slice(-6)}`,
    });
    // Tmail messaging keys are derived from the same mnemonic (local-only; only the public keys
    // are later published to the node key directory).
    try {
      const kem = await deriveTmailKeysFromMnemonic(phrase);
      tmailKeysRef.current = kem;
      setTmailKeys(kem);
    } catch {
      tmailKeysRef.current = null;
      setTmailKeys(null);
    }
    setFounderWalletIdHex64(wid);
    setActiveAccountAddress(`${wid.slice(0, 10)}…${wid.slice(-8)}`);
    if (wid !== GENESIS_FOUNDER_WALLET_ID_HEX) {
      appendLedger([
        "[INFO] Active wallet_id differs from default genesis dev key — use this Wallet ID on tet-core (faucet / mint) for balances.",
      ]);
    }
    setWalletGate("ready");
    setWalletUnlockOpen(false);
    setWalletUnlockErr("");
    appendLedger(["[Wallet] Unlocked — Ed25519 + ML-DSA session active for this tab."]);
  }

  async function applyUnlockedHybridSessionFromVault(masterPassword: string) {
    await pqcInit();
    const u = await unlockVault(masterPassword.trim());
    const wid = u.walletIdHex.trim().toLowerCase();
    setHybridSignerSession({
      walletIdHex64: wid,
      signEd25519: async (buf) => {
        const data = new Uint8Array(buf.byteLength);
        data.set(buf);
        const sig = await crypto.subtle.sign("Ed25519", u.privateKey, data);
        return new Uint8Array(sig);
      },
      mldsa44_keypair_b64: u.mldsa44_keypair_b64,
      mldsa44_pubkey_b64: u.mldsa44_pubkey_b64,
      displayAddress: `${wid.slice(0, 10)}…${wid.slice(-6)}`,
    });
    // Vault wallets don't expose the mnemonic, so Tmail KEM keys can't be derived here.
    tmailKeysRef.current = null;
    setTmailKeys(null);
    setFounderWalletIdHex64(wid);
    setActiveAccountAddress(`${wid.slice(0, 10)}…${wid.slice(-8)}`);
    setWalletGate("ready");
    setWalletUnlockOpen(false);
    setWalletUnlockErr("");
    appendLedger(["[Wallet] Vault unlocked — using setup wallet (WebCrypto Ed25519 + ML-DSA)."]);
  }

  async function onWalletUnlockSubmit() {
    setWalletBusy(true);
    setWalletUnlockErr("");
    try {
      if (persistedWalletKind === "vault") {
        await applyUnlockedHybridSessionFromVault(walletSecretInput);
        return;
      }
      if (persistedWalletKind === "legacy_plain") {
        const ws = loadWalletStore();
        if (!ws) throw new Error("Wallet file missing.");
        const pin = walletSecretInput.trim();
        if (!isValidWalletPin(pin)) throw new Error("PIN must be 6–8 digits.");
        const h = await sha256Hex(pin);
        if (h !== ws.pin_sha256_hex) throw new Error("Invalid PIN.");
        const phrase = ws.mnemonic12.trim().toLowerCase().replace(/\s+/g, " ");
        await createInAppWalletWithMnemonic(pin, phrase);
        clearWalletStore();
        setPersistedWalletKind("inapp");
        await applyUnlockedHybridSessionFromMnemonic(phrase);
        return;
      }
      if (persistedWalletKind === "inapp") {
        const pin = walletSecretInput.trim();
        if (!isValidWalletPin(pin)) {
          throw new Error("Invalid PIN: use 6–8 digits.");
        }
        const { mnemonic12 } = await unlockInAppWallet(pin);
        const norm = mnemonic12.trim().toLowerCase().replace(/\s+/g, " ");
        await applyUnlockedHybridSessionFromMnemonic(norm);
        return;
      }
      setWalletUnlockErr("No Wallet: create or import a wallet below.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setWalletUnlockErr(msg || "Unlock failed");
    } finally {
      setWalletBusy(false);
    }
  }

  async function onWalletCreateSave() {
    setWalletBusy(true);
    setWalletUnlockErr("");
    try {
      const pin = newWalletPin.trim();
      if (!isValidWalletPin(pin)) {
        throw new Error("PIN must be 6–8 digits.");
      }
      const phrase = newMnemonicDraft.trim().toLowerCase().replace(/\s+/g, " ");
      if (!mnemonicValidate(phrase)) {
        throw new Error("Invalid Mnemonic: generate seeds first.");
      }
      await createInAppWalletWithMnemonic(pin, phrase);
      setPersistedWalletKind("inapp");
      await applyUnlockedHybridSessionFromMnemonic(phrase);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setWalletUnlockErr(msg || "Create failed");
    } finally {
      setWalletBusy(false);
    }
  }

  async function onWalletImportSave() {
    setWalletBusy(true);
    setWalletUnlockErr("");
    try {
      const pin = importWalletPin.trim();
      if (!isValidWalletPin(pin)) {
        throw new Error("PIN must be 6–8 digits.");
      }
      const phrase = importMnemonicInput.trim().toLowerCase().replace(/\s+/g, " ");
      if (!mnemonicValidate(phrase)) {
        throw new Error("Invalid Mnemonic: check your 12 words.");
      }
      await createInAppWalletWithMnemonic(pin, phrase);
      setPersistedWalletKind("inapp");
      await applyUnlockedHybridSessionFromMnemonic(phrase);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setWalletUnlockErr(msg || "Import failed");
    } finally {
      setWalletBusy(false);
    }
  }

  function lockWalletSession() {
    setHybridSignerSession(null);
    welcomeAirdropShownRef.current = false;
    setWelcomeAirdropBanner(null);
    // Drop Tmail key material + decrypted messages from memory on lock.
    tmailKeysRef.current = null;
    setTmailKeys(null);
    tmailAutoRegisteredRef.current = "";
    setTmailInbox([]);
    setTmailKeysRegisteredAtMs(null);
    setTmailKeyStatus("unknown");
    setTmailComposeMsg("");
    setWalletGate("locked");
    setFounderWalletIdHex64("—");
    setActiveAccountAddress("—");
    setBalanceStevemon(null);
    setWalletSecretInput("");
    setWalletUnlockErr("");
    setWalletUnlockOpen(true);
    appendLedger(["[Wallet] Locked — hybrid signing cleared for this tab."]);
  }

  // ───────────────────────── Messages (Tmail Basic E2EE) ─────────────────────────

  /** Publish the unlocked wallet's derived KEM public keys (hybrid-signed) to the node directory. */
  const registerTmailKeysNow = useCallback(async (): Promise<boolean> => {
    const sess = getHybridSignerSession();
    const kem = tmailKeysRef.current;
    if (!sess || !kem) return false;
    const wid = sess.walletIdHex64;
    try {
      setTmailKeyStatus("registering");
      const reg = await buildTmailKeyRegistrationV1(wid, kem, baseUrl);
      const res = await putTmailKeys(baseUrl, wid, reg);
      if (res.ok) {
        setTmailKeysRegisteredAtMs(res.data?.registered_at_ms ?? reg.registered_at_ms);
        setTmailKeyStatus("registered");
        return true;
      }
      setTmailKeyStatus("error");
      appendLedger([`[Messages] key registration failed — HTTP ${res.status}`]);
      return false;
    } catch (e: unknown) {
      setTmailKeyStatus("error");
      appendLedger([`[Messages] key registration error — ${e instanceof Error ? e.message : String(e)}`]);
      return false;
    }
  }, [baseUrl]);

  // On unlock: check the directory once; if unregistered (404), auto-publish the KEM public keys so
  // that other wallets can send before this user ever opens the Messages tab.
  useEffect(() => {
    if (walletGate !== "ready" || !tmailKeys) return;
    const sess = getHybridSignerSession();
    if (!sess) return;
    const wid = sess.walletIdHex64;
    if (tmailAutoRegisteredRef.current === wid) return;
    tmailAutoRegisteredRef.current = wid;
    let cancelled = false;
    void (async () => {
      const existing = await getTmailKeys(baseUrl, wid);
      if (cancelled) return;
      if (existing.registration) {
        setTmailKeysRegisteredAtMs(existing.registration.registered_at_ms);
        setTmailKeyStatus("registered");
        return;
      }
      if (existing.status === 404) {
        setTmailKeyStatus("unregistered");
        const ok = await registerTmailKeysNow();
        if (!cancelled && ok) {
          appendLedger(["[Messages] Messaging keys published to the node directory."]);
        }
      } else {
        setTmailKeyStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletGate, tmailKeys, baseUrl, registerTmailKeysNow]);

  // Inbox polling (5s) while the Messages tab is open + wallet ready. Decrypts each envelope with the
  // receiver's local KEM keys; envelopes that don't decrypt (not for us / corrupt) are skipped.
  useEffect(() => {
    if (tab !== "Messages" || walletGate !== "ready" || !tmailKeys) return;
    const sess = getHybridSignerSession();
    if (!sess) return;
    const wid = sess.walletIdHex64;
    let cancelled = false;

    const poll = async () => {
      const res = await getTmailInbox(baseUrl, wid, 50);
      if (cancelled || !res.ok || !res.data) return;
      const kem = tmailKeysRef.current;
      if (!kem) return;
      const decrypted: DecryptedTmail[] = [];
      for (const env of res.data.messages as TmailEnvelopeV1[]) {
        try {
          const plaintext = await decryptTmailEnvelope(env, kem);
          decrypted.push({
            msgId: env.msg_id,
            sender: env.sender_wallet_id,
            sentAtMs: env.sent_at_ms,
            plaintext,
          });
        } catch {
          // Not addressed to us or corrupt — skip silently.
        }
      }
      if (cancelled) return;
      decrypted.sort((a, b) => b.sentAtMs - a.sentAtMs);
      setTmailInbox(decrypted);
    };

    void poll();
    const id = window.setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tab, walletGate, tmailKeys, baseUrl]);

  /** Compose flow: fetch recipient KEM keys → encrypt + hybrid-sign → POST /tmail/send. */
  async function sendTmailMessage() {
    const sess = getHybridSignerSession();
    if (!sess) {
      setTmailComposeMsg("Unlock your wallet before sending a message.");
      return;
    }
    if (!tmailKeysRef.current) {
      setTmailComposeMsg("Messaging keys unavailable for this wallet (vault wallets can't message yet).");
      return;
    }
    const recipient = normalizeWalletId64(tmailRecipient);
    if (!recipient) {
      setTmailComposeMsg("Recipient must be a 64-hex wallet ID.");
      return;
    }
    if (recipient === sess.walletIdHex64) {
      setTmailComposeMsg("Cannot send a message to yourself.");
      return;
    }
    const body = tmailBody;
    if (!body.trim()) {
      setTmailComposeMsg("Message body is empty.");
      return;
    }
    if (new TextEncoder().encode(body).length > TMAIL_BODY_MAX) {
      setTmailComposeMsg(`Message too long (max ${TMAIL_BODY_MAX} bytes).`);
      return;
    }

    setTmailSending(true);
    setTmailComposeMsg("Looking up recipient keys…");
    try {
      const keys = await getTmailKeys(baseUrl, recipient);
      if (!keys.registration) {
        setTmailComposeMsg(
          keys.status === 404
            ? "Recipient hasn't registered messaging keys yet."
            : `Could not load recipient keys (HTTP ${keys.status}).`,
        );
        return;
      }
      setTmailComposeMsg("Encrypting + signing…");
      const env = await buildTmailEnvelopeV1({
        senderWalletIdHex64: sess.walletIdHex64,
        receiverWalletIdHex64: recipient,
        plaintextUtf8: body,
        receiverX25519Pub: b64ToBytes(keys.registration.x25519_pub_b64),
        receiverMlkemPub: b64ToBytes(keys.registration.mlkem_pub_b64),
        baseUrl,
      });
      const res = await postTmailSend(baseUrl, env);
      if (res.ok || res.status === 202) {
        setTmailComposeMsg(`Sent (msg_id: ${env.msg_id.slice(0, 8)}…).`);
        setTmailBody("");
        appendLedger([`[Messages] Encrypted message sent → ${recipient.slice(0, 12)}…`]);
      } else if (res.status === 409) {
        setTmailComposeMsg("Already sent (duplicate msg_id).");
      } else {
        setTmailComposeMsg(`Send failed (HTTP ${res.status}).`);
        appendLedger([`[Messages] send failed — HTTP ${res.status}: ${res.text ?? ""}`]);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setTmailComposeMsg(`Send error — ${msg}`);
      appendLedger([`[Messages] send error — ${msg}`]);
    } finally {
      setTmailSending(false);
    }
  }

  function persistTxRows(rows: TxRowV0[]) {
    setTxs(rows);
    saveTxs({ v: 0, rows });
  }

  function addTx(type: TxType, address: string, amountStevemon: bigint, message?: string) {
    const row: TxRowV0 = {
      ts_ms: Date.now(),
      type,
      address,
      amount_tet: formatStevemonToTet(amountStevemon),
      amount_stevemon: amountStevemon.toString(),
      message: message && message.trim() ? message.trim().slice(0, 64) : undefined,
    };
    const next = [row, ...txs].slice(0, 200);
    persistTxRows(next);
  }

  /** REST-only L1: clear local history manually when switching networks. */
  function loadTxHistoryFromStorage(): boolean {
    if (typeof window === "undefined") return false;
    try {
      const raw = window.localStorage.getItem(TX_HISTORY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setTxHistory(parsed);
          return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  }

  function clearTxHistoryStorage() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(TX_HISTORY_STORAGE_KEY);
    } catch {
      // ignore
    }
    setTxHistory([]);
    appendLedger(["[TX History] Cleared local Recent Transactions (localStorage)."]);
  }

  useEffect(() => {
    const s = loadSession();
    if (!s) {
      router.replace("/");
      return;
    }
    setAddress(s.address || "—");
    // Balance comes only from the selected dev identity + on-chain subscription (see identity effect).
    // Do not hydrate from session to avoid a one-frame mismatch with `activeAccountAddress` / `founderWalletIdHex64`.

    const txStore = loadTxs();
    setTxs(txStore.rows);
    const ab = loadAddressBook();
    setAddrBook(ab.entries);

  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    loadTxHistoryFromStorage();
    setIsLoaded(true);
  }, []);

  /** First paint: detect persisted wallet; user must unlock (session signer is never auto-filled). */
  useEffect(() => {
    if (!isLoaded) return;
    const k = detectOsWalletStorageKind();
    setPersistedWalletKind(k);
    setWalletGate("locked");
    setWalletUnlockErr("");
    setWalletSecretInput("");
    setNewMnemonicDraft("");
    setNewWalletPin("");
    setImportMnemonicInput("");
    setImportWalletPin("");
    setWalletUnlockOpen(true);
  }, [isLoaded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isLoaded) return;
    try {
      window.localStorage.setItem(TX_HISTORY_STORAGE_KEY, JSON.stringify(txHistory));
    } catch {
      // ignore
    }
  }, [txHistory, isLoaded]);

  // Network telemetry: `/ledger/state` (sync gate), `/v1/vision/network/stats`, `/market/index`, `/explorer/events`.
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;

      const stateRes = await fetchLedgerState(baseUrl);
      if (cancelled) return;
      if (stateRes.ok && stateRes.state) {
        ledgerStateFetchedOnceRef.current = true;
        setLedgerState(stateRes.state);
        setSyncUi(deriveSyncUi(stateRes.state, { offline: false, connecting: false }));
        setBestNumber(stateRes.state.block_height);
      } else {
        setLedgerState(null);
        setSyncUi(
          deriveSyncUi(null, {
            offline: ledgerStateFetchedOnceRef.current,
            connecting: !ledgerStateFetchedOnceRef.current,
          }),
        );
      }

      const statsMicro = await fetchNetworkStatsMicro(baseUrl);
      const blockRes = await fetchLedgerBlocks(baseUrl);
      let supMicro: bigint | null = null;

      if (statsMicro.ok) {
        if (statsMicro.total_supply_micro !== null) {
          supMicro = statsMicro.total_supply_micro;
        }
        if (statsMicro.total_burned_micro !== null) {
          setNetworkBurnedStevemon(statsMicro.total_burned_micro);
        }
        if (statsMicro.active_worker_nodes !== null) {
          setStatusWorkers(statsMicro.active_worker_nodes);
        }
        if (statsMicro.consensus_block_height !== null) {
          const h = Number(statsMicro.consensus_block_height);
          if (Number.isFinite(h)) setBestNumber(h);
        }
        if (statsMicro.epoch !== null) setNetworkEpoch(statsMicro.epoch);
        setNetworkTflops(statsMicro.total_compute_tflops);
        if (statsMicro.system_worker_pool_balance_micro !== null) {
          setWorkerPoolBalanceStevemon(statsMicro.system_worker_pool_balance_micro);
        } else {
          setWorkerPoolBalanceStevemon(null);
        }
      } else {
        setWorkerPoolBalanceStevemon(null);
        setNetworkEpoch(null);
        setNetworkTflops(null);
      }

      if (blockRes.ok) {
        const blocks = blockRes.blocks
          .filter((b) => typeof b.height === "number" && Number.isFinite(b.height))
          .slice(0, 8)
          .map((b) => ({
            height: b.height,
            block_id: b.block_id,
            state_root: b.state_root,
            tx_count: typeof b.tx_count === "number" && Number.isFinite(b.tx_count) ? b.tx_count : 0,
            ts_ms: b.ts_ms,
          }));
        setLatestBlocks(blocks);
        if (blocks.length > 0) {
          setBestNumber(blocks[0]!.height);
        }
      }

      if (supMicro === null) {
        supMicro = await fetchMarketTotalSupplyMicro(baseUrl);
      }

      if (supMicro === null) {
        setTotalSupplyStevemon(null);
        setTotalSupply("—");
      } else if (supMicro === 0n) {
        setTotalSupplyStevemon(null);
        setTotalSupply("(syncing…)");
      } else {
        setTotalSupplyStevemon(supMicro);
        setTotalSupply(formatStevemonToTetDisplay(supMicro));
      }

      const nc = await getVisionNetworkConfig(baseUrl);
      if (nc.ok && nc.data && typeof nc.data === "object") {
        const raw = (nc.data as Record<string, unknown>).connected_peers;
        if (typeof raw === "number" && Number.isFinite(raw)) {
          setConnectedPeers(raw);
        } else if (typeof raw === "string") {
          const n = Number.parseInt(raw, 10);
          if (Number.isFinite(n)) setConnectedPeers(n);
        }
      }

      const ev = await fetchJson<{ seq: number; hash_hex?: string }[]>(
        tetCoreUrl(baseUrl, "/explorer/events?limit=500"),
      );
      if (ev.ok && Array.isArray(ev.data) && ev.data.length > 0) {
        let maxSeq = 0;
        for (const row of ev.data) {
          if (typeof row.seq === "number" && row.seq > maxSeq) maxSeq = row.seq;
        }
        if (!blockRes.ok) setBestNumber(maxSeq);
        if (lastLoggedLedgerSeqRef.current !== maxSeq) {
          lastLoggedLedgerSeqRef.current = maxSeq;
          const tip = ev.data[0];
          const hs =
            tip?.hash_hex && tip.hash_hex.length > 10 ? `${tip.hash_hex.slice(0, 10)}…` : "—";
          setMiningLog((prev) => {
            const newLog = `${fmtDate(Date.now())}  [TET-Core] Ledger seq #${maxSeq.toLocaleString("en-US")} (tip hash ${hs})`;
            return [newLog, ...prev].slice(0, 200);
          });
        }
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [baseUrl]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const r = await getVisionPqcStatus(baseUrl);
      if (cancelled) return;
      if (r.ok && r.data && typeof r.data === "object") {
        const d = r.data as Record<string, unknown>;
        const active = d.pqc_active === true;
        const lvl = typeof d.env_generation_level === "string" ? d.env_generation_level : "";
        const profile =
          typeof d.mldsa_profile_default === "string" ? d.mldsa_profile_default : "";
        const m = profile.match(/ML-DSA-\d+/);
        const shortLevel = m ? m[0] : "ML-DSA-65";
        setPqcStatusShort(lvl ? `${active ? "PQC on" : "PQC off"} · ${lvl}` : active ? "PQC on" : "PQC off");
        if (active) {
          setStatusSecurity({ label: `Security: ${shortLevel} Active`, active: true });
        } else {
          setStatusSecurity({ label: "Security: PQC off", active: false });
        }
      } else {
        setPqcStatusShort("—");
        setStatusSecurity({ label: "Security: —", active: false });
        if (!r.ok) {
          console.error("[OsClient] GET /v1/vision/pqc/status failed", r.status, r.text);
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [baseUrl]);

  // Unlocked wallet: `/ledger/me` + transfer hints (wallet_id = Ed25519 pubkey hex from local wallet).
  useEffect(() => {
    let cancelled = false;
    let pollInterval: number | undefined;

    const wid = founderWalletIdHex64.trim().toLowerCase();
    if (wid.length !== 64 || !/^[0-9a-f]+$/.test(wid)) {
      setBalanceStevemon(null);
      setWalletInferenceBurnStevemon(null);
      return;
    }

    seenTransferSeqRef.current = new Set();

    const pollIdentity = async () => {
      if (cancelled) return;
      const res = await getLedgerMeBalanceMicro(baseUrl, wid);
      const burnRes = await getLedgerMeWalletInferenceBurnMicro(baseUrl, wid);
      if (cancelled) return;
      if (res.ok) {
        const prev = previousBalanceRef.current;
        if (prev != null && res.micro > prev) {
          const delta = res.micro - prev;
          setLastWalletRewardDelta(delta);
          appendLedger([
            `[Reward] Wallet balance increased +${formatStevemonToTetFullDisplay(delta)} TET (${delta.toLocaleString("en-US")}µ) — base reward + dynamic compute reward may be included.`,
          ]);
        }
        previousBalanceRef.current = res.micro;
        setBalanceStevemon(res.micro);
      } else {
        setBalanceStevemon(null);
        previousBalanceRef.current = null;
        console.error("[OsClient] ledger balance unavailable", res.reason);
      }
      if (burnRes.ok) {
        setWalletInferenceBurnStevemon(burnRes.micro);
      } else {
        setWalletInferenceBurnStevemon(null);
      }
    };

    const pollTransfers = async () => {
      if (cancelled) return;
      const r = await fetchJson<{ seq: number; record: Record<string, unknown> }[]>(
        tetCoreUrl(baseUrl, "/explorer/events?limit=200"),
      );
      if (!r.ok || !Array.isArray(r.data)) return;
      for (const e of r.data) {
        const rec = e.record;
        if (String(rec?.action ?? "") !== "transfer") continue;
        const from = String(rec.from_wallet ?? "").toLowerCase();
        const to = String(rec.to_wallet ?? "").toLowerCase();
        if (from !== wid && to !== wid) continue;
        const sk = `${e.seq}`;
        if (seenTransferSeqRef.current.has(sk)) continue;
        seenTransferSeqRef.current.add(sk);
        const amtRaw = rec.amount_micro;
        const amtNum =
          typeof amtRaw === "number" ? amtRaw : typeof amtRaw === "string" ? Number(amtRaw) : 0;
        const micro = Number.isFinite(amtNum) ? amtNum : 0;
        const counterparty = from === wid ? to : from;
        const item = {
          date: new Date().toLocaleString(),
          type: "Transfer",
          address: counterparty.length === 64 ? `${counterparty.slice(0, 8)}…${counterparty.slice(-6)}` : counterparty,
          amount: `${formatStevemonToTetDisplay(BigInt(Math.floor(micro)))} TET`,
        };
        setTxHistory((prev) => [item, ...prev].slice(0, 200));
      }
    };

    void (async () => {
      await pollIdentity();
      await pollTransfers();
      if (cancelled) return;
      pollInterval = window.setInterval(() => {
        void pollIdentity();
        void pollTransfers();
      }, 12_000);
    })();

    return () => {
      cancelled = true;
      if (pollInterval !== undefined) window.clearInterval(pollInterval);
    };
  }, [baseUrl, founderWalletIdHex64]);

  useEffect(() => {
    const wid = normalizeWalletId64(founderWalletIdHex64);
    if (!wid) {
      setNetworkCaacLine("—");
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const r = await getWorkerStats(baseUrl, wid);
      if (cancelled) return;
      if (r.ok && r.data) {
        const role = r.data.caac_role;
        const ms = r.data.caac_latency_ms;
        if (role) {
          setNetworkCaacLine(
            ms != null && Number.isFinite(ms) ? `${role} · ${ms}ms (attested)` : `${role} (attested)`,
          );
        } else {
          setNetworkCaacLine("no CAAC attestation (complete /v1/vision/caac/… after bond)");
        }
      } else {
        setNetworkCaacLine("worker not in registry");
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [baseUrl, founderWalletIdHex64]);

  useEffect(() => {
    const wid = normalizeWalletId64(founderWalletIdHex64);
    if (!wid) {
      setWorkerCockpit(null);
      setWorkerCockpitErr("Unlock wallet to attach Worker.");
      return;
    }
    let cancelled = false;
    const tick = async () => {
      setWorkerCockpitLoading(true);
      const r = await fetchWorkerCockpit(baseUrl, wid);
      if (cancelled) return;
      setWorkerCockpitLoading(false);
      if (!r.ok) {
        setWorkerCockpitErr(r.error);
        return;
      }
      setWorkerCockpitErr("");
      setWorkerCockpit(r.data);
      setWorkerCockpitUpdatedAt(Date.now());
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [baseUrl, founderWalletIdHex64]);

  useEffect(() => {
    if (!miningOn) return;
    let alive = true;
    const url = tetCoreUrl(middlewareUrl, "/logs");
    let es: EventSource | null = null;

    try {
      es = new EventSource(url);
    } catch {
      setMiningLog((prev) => {
        const next = [...prev, `${fmtDate(Date.now())}  Worker: Connection Failed`];
        return next.length > 2000 ? next.slice(next.length - 2000) : next;
      });
      setMiningOn(false);
      return;
    }

    es.onopen = () => {
      if (!alive) return;
      setMiningLog((prev) => {
        const next = [...prev, `${fmtDate(Date.now())}  Worker: Active (Connected to TET-Core)`];
        return next.length > 2000 ? next.slice(next.length - 2000) : next;
      });
    };

    es.onmessage = (e) => {
      if (!alive) return;
      const line = (e?.data ?? "").toString();
      if (!line) return;
      setMiningLog((prev) => {
        const next = [...prev, `${fmtDate(Date.now())}  ${line}`];
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    };

    es.onerror = (e) => {
      // EventSource errors are often CORS or server-down; log diagnostics.
      // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
      // eslint-disable-next-line no-console
      console.error("[WorkerMode SSE] error", { url, readyState: es?.readyState, event: e });
      if (!alive) return;
      setMiningLog((prev) => {
        const next = [...prev, `${fmtDate(Date.now())}  Worker: Disconnected`];
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
      try {
        es?.close();
      } catch {
        // ignore
      }
      setMiningOn(false);
    };

    return () => {
      alive = false;
      try {
        es?.close();
      } catch {
        // ignore
      }
    };
  }, [miningOn, middlewareUrl]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const r = await getVisionCaacProfile(baseUrl);
      if (cancelled) return;
      if (r.ok && r.data) setVisionCaacRole(String(r.data.role));
      else setVisionCaacRole("—");
    };
    void tick();
    const id = window.setInterval(() => void tick(), 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [baseUrl]);

  useEffect(() => {
    const t = aiTaskPrompt.trim();
    if (!t) {
      setVisionInferThermo(null);
      return;
    }
    const flops = estimateVisionInferFlopsFromPromptChars(aiTaskPrompt.length);
    const micro = Number(AI_TASK_DISPLAY_ESCROW_MICRO);
    const half = Math.floor(micro / 2);
    setVisionInferThermo({
      estimatedFlops: flops,
      totalMicro: micro,
      thermodynamicRMicro: micro,
      workerMicro: half,
      burnMicro: micro - half,
    });
  }, [aiTaskPrompt]);

  useEffect(() => {
    const el = aiChatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [aiChatMessages, aiTaskSubmitting]);

  function TabButton(props: { id: TabId }) {
    const active = tab === props.id;
    return (
      <button
        type="button"
        onClick={() => setTab(props.id)}
        className={[
          "rounded-none border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] px-3 py-1 text-sm select-none",
          active
            ? "bg-[#D4D0C8] relative top-[1px] z-10 border-b-[#D4D0C8]"
            : "bg-[#C0C0C0] border-b-[#808080]",
          "focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-black focus-visible:outline-offset-2",
        ].join(" ")}
      >
        <span
          className={
            active ? "outline outline-1 outline-dotted outline-black outline-offset-[2px] px-0.5" : undefined
          }
        >
          {props.id}
        </span>
      </button>
    );
  }

  function MenuButton(props: { id: Exclude<MenuId, null> }) {
    const open = menuOpen === props.id;
    const hotkey = props.id[0];
    const rest = props.id.slice(1);
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(open ? null : props.id);
        }}
        className={[
          "px-2 py-0.5 text-sm select-none",
          open ? "bg-[#000080] text-white" : "",
        ].join(" ")}
      >
        <span className="underline underline-offset-2">{hotkey}</span>
        <span>{rest}</span>
      </button>
    );
  }

  function MenuDropdown(props: { id: Exclude<MenuId, null>; items: { label: string; onClick: () => void }[] }) {
    if (menuOpen !== props.id) return null;
    return (
      <div
        className={`${outset} absolute mt-1 ${panel} text-sm z-50`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {props.items.map((it) => (
          <button
            key={it.label}
            type="button"
            onClick={() => {
              setMenuOpen(null);
              it.onClick();
            }}
            className="block w-full text-left px-4 py-1"
          >
            {it.label}
          </button>
        ))}
      </div>
    );
  }

  async function onSendCoins() {
    if (sendingTx) return;
    setSendTransferUserMsg("");
    setSendTransferPhase("idle");

    const sess = getHybridSignerSession();
    if (!sess) {
      setSendTransferPhase("failed");
      setSendTransferUserMsg("Unlock your wallet first (File → Wallet…).");
      appendLedger(["Send Coins: no wallet session — unlock wallet first."]);
      return;
    }

    const from = normalizeWalletId64(founderWalletIdHex64);
    if (!from) {
      setSendTransferPhase("failed");
      setSendTransferUserMsg("From wallet is not ready.");
      appendLedger(["Send Coins: invalid From wallet id."]);
      return;
    }

    const to = normalizeWalletId64(sendTo.trim());
    if (!to) {
      setSendTransferPhase("failed");
      setSendTransferUserMsg("Pay To must be a 64-character hex wallet id.");
      appendLedger(["Send Coins: Pay To must be 64 hex chars (Ed25519 wallet id)."]);
      return;
    }
    if (from === to) {
      setSendTransferPhase("failed");
      setSendTransferUserMsg("Cannot send to the same wallet.");
      appendLedger(["Send Coins: cannot transfer to self."]);
      return;
    }

    const amtStv = parseTet(sendAmountTet.trim());
    if (amtStv == null) {
      setSendTransferPhase("failed");
      setSendTransferUserMsg("Enter a valid amount in TET (e.g. 0.001).");
      appendLedger(["Send Coins: invalid Amount"]);
      return;
    }
    if (amtStv < MIN_SEND_MICRO) {
      setSendTransferPhase("failed");
      setSendTransferUserMsg("Minimum transfer is 0.001 TET.");
      appendLedger(["Send Coins: minimum amount is 0.001 TET"]);
      return;
    }

    if (balanceStevemon != null && amtStv > balanceStevemon) {
      setSendTransferPhase("failed");
      setSendTransferUserMsg("Amount exceeds your balance (fee is included in the gross).");
      appendLedger(["Send Coins: insufficient balance"]);
      return;
    }

    const msg = sendMessage.trim().slice(0, 64);
    setSendingTx(true);
    setSendTransferPhase("signing");

    try {
      const env = await buildTransferEnvelope(from, to, amtStv, baseUrl);
      setSendTransferPhase("submitting");
      appendLedger([
        `[Send Coins] POST /wallet/transfer · gross ${formatStevemonToTetDisplay(amtStv)} TET → ${to.slice(0, 12)}…`,
      ]);

      const res = await postWalletTransfer(baseUrl, env);
      // 202 Accepted: tx is queued + gossiped; it commits once a producer mines it.
      if (!res.ok || !res.data?.tx_hash) {
        const err = userFacingTransferError(res.status, res.text);
        setSendTransferPhase("failed");
        setSendTransferUserMsg(err);
        appendLedger([`Send Coins: failed — ${err}`]);
        console.error("[Send Coins] POST /wallet/transfer failed", res);
        return;
      }

      const txHash = res.data.tx_hash;
      setSendTransferPhase("pending");
      setSendTransferUserMsg(
        `Transaction pending (${txHash.slice(0, 10)}…). Waiting for block confirmation…`,
      );
      appendLedger([
        `[Send Coins] queued + gossiped · tx ${txHash.slice(0, 18)}… · awaiting block inclusion`,
      ]);
      if (msg) {
        appendLedger([`[Memo] "${msg}" (local note only — not sent on-chain).`]);
      }

      // Poll the tx index until a producer mines the tx into a block (or we time out).
      const CONFIRM_TIMEOUT_MS = 30_000;
      const POLL_INTERVAL_MS = 3_000;
      const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
      let confirmedHeight: number | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const txRes = await fetchExplorerTx(baseUrl, txHash);
        if (txRes.ok && txRes.data?.found) {
          confirmedHeight = txRes.data.block_height;
          break;
        }
      }

      if (confirmedHeight != null) {
        setSendTransferPhase("confirmed");
        setSendTransferUserMsg(
          `Confirmed in block ${confirmedHeight}. Sent ${formatStevemonToTetDisplay(amtStv)} TET (1% fee applied).`,
        );
        appendLedger([
          `[Send Coins] ✅ confirmed in block ${confirmedHeight} · tx ${txHash.slice(0, 18)}…`,
        ]);
      } else {
        // Still pending: not an error — no producer has mined it yet.
        setSendTransferUserMsg(
          `Still pending after 30s (tx ${txHash.slice(0, 10)}…). It will commit once a producer mines it.`,
        );
        appendLedger([
          `[Send Coins] ⏳ not yet mined after 30s · tx ${txHash.slice(0, 18)}… (will confirm later)`,
        ]);
      }

      const bal = await getLedgerMeBalanceMicro(baseUrl, from);
      if (bal.ok) {
        previousBalanceRef.current = bal.micro;
        setBalanceStevemon(bal.micro);
      }
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      setSendTransferPhase("failed");
      setSendTransferUserMsg(detail.includes("Wallet") ? detail : "Signing or network error. See console.");
      appendLedger([`Send Coins: ${detail}`]);
      console.error("[Send Coins] unexpected error", e);
    } finally {
      setSendingTx(false);
    }
  }

  async function onSubmitAiTaskRequest() {
    if (aiTaskSubmitting) return;
    const text = aiTaskPrompt.trim();
    if (!text) {
      appendLedger(["AI Task: Prompt empty"]);
      return;
    }
    const promptBytes = stringToU8a(text);
    if (promptBytes.length > AI_PROMPT_MAX_BYTES) {
      appendLedger([`AI Task: Prompt exceeds ${AI_PROMPT_MAX_BYTES} bytes (${promptBytes.length})`]);
      return;
    }
    const sess = getHybridSignerSession();
    if (!sess) {
      appendLedger(["AI Task: No Wallet — unlock wallet in Wallet dialog (File → Wallet…)."]);
      setAiChatMessages((prev) => [
        ...prev,
        {
          id: `assistant-wallet-${Date.now()}`,
          role: "assistant",
          ts: Date.now(),
          status: "error",
          text: "Unlock your wallet first from File -> Wallet. TET-Network needs a signer to submit this compute request.",
        },
      ]);
      return;
    }

    const submittedAt = Date.now();
    const userMessage: AiChatMessage = {
      id: `user-${submittedAt}`,
      role: "user",
      ts: submittedAt,
      text,
    };
    setAiTaskSubmitting(true);
    setAiChatMessages((prev) => [...prev, userMessage]);
    setAiTaskPrompt("");
    appendLedger([
      `[SYSTEM] POST /enterprise/inference/submit (wallet ${sess.walletIdHex64.slice(0, 8)}…) · Workload Flag=1`,
    ]);

    try {
      const wid = sess.walletIdHex64;
      const flops = estimateVisionInferFlopsFromPromptChars(text.length);
      const amountMicro = BigInt(Math.max(1, visionInferThermo?.totalMicro ?? Number(AI_TASK_DISPLAY_ESCROW_MICRO)));
      const out = await postEnterpriseInference(baseUrl, wid, text, amountMicro, "llama3");
      if (!out.ok) {
        appendLedger([`[AI Task] ${out.text ?? "request failed"}`]);
        setAiChatMessages((prev) => [
          ...prev,
          {
            id: `assistant-error-${Date.now()}`,
            role: "assistant",
            ts: Date.now(),
            status: "error",
            text: `The network rejected this request: ${out.text ?? "request failed"}`,
          },
        ]);
        setAiTaskSubmitting(false);
        return;
      }
      setLastAiDemandTaskId(out.task_id_hint ?? null);
      setAiChatMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          ts: Date.now(),
          status: "queued",
          text: [
            "Your prompt is now in the TET compute queue.",
            `Task: ${out.task_id_hint ?? "pending"}`,
            "Workers will compete to process it, generate proof, and settle the result on-chain.",
          ].join("\n"),
        },
      ]);
      appendLedger([
        `[AI Task] L1 demand queued · task_id≈${out.task_id_hint ?? "pending"} · est_flops=${flops.toLocaleString()} · amount=${amountMicro.toLocaleString()}µ`,
        "[AI Task] Watch: Block height should advance, Worker Pool should decrease, wallet balance should rise after Worker Daemon submits VerifyZkProof.",
      ]);
    } catch (e: unknown) {
      const em = e instanceof Error ? e.message : String(e);
      setAiChatMessages((prev) => [
        ...prev,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          ts: Date.now(),
          status: "error",
          text: `Connection failed while contacting TET-Network: ${em}`,
        },
      ]);
      appendLedger([`[AI Task] ERROR: ${em}`]);
    } finally {
      setAiTaskSubmitting(false);
    }
  }

  function onAddAddress(label: string, addr: string) {
    const l = label.trim();
    const a = addr.trim();
    if (!l || !a) return;
    const next = [{ label: l, address: a, created_at_ms: Date.now() }, ...addrBook].slice(0, 100);
    setAddrBook(next);
    saveAddressBook({ v: 0, entries: next });
  }

  async function onExplorerSearch(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const raw = explorerQuery.trim();
    setExplorerErr("");
    setExplorerBlock(null);
    setExplorerTx(null);
    if (!raw) {
      setExplorerErr("Enter Block Height or Tx Hash.");
      return;
    }
    setExplorerLoading(true);
    try {
      if (/^\d+$/.test(raw)) {
        const r = await fetchLedgerBlock(baseUrl, raw);
        if (!r.ok || !r.data) {
          setExplorerErr(r.text ?? `HTTP ${r.status}`);
          return;
        }
        setExplorerBlock(r.data);
        return;
      }
      const hex = normalizeHexInput(raw);
      if (/^[0-9a-f]{64}$/.test(hex)) {
        const r = await fetchExplorerTx(baseUrl, `0x${hex}`);
        if (!r.ok || !r.data) {
          setExplorerErr(r.text ?? `HTTP ${r.status}`);
          return;
        }
        setExplorerTx(r.data);
        return;
      }
      setExplorerErr("Unknown search format. Enter a numeric Block Height or a 64-hex / 0x-prefixed Tx Hash.");
    } finally {
      setExplorerLoading(false);
    }
  }

  function onStartMiningGpu() {
    setMiningOn(true);
    const now = fmtDate(Date.now());
    setMiningLog((prev) =>
      [
        `${now}  [WORKER] Start Mining (GPU) armed from TET-OS Worker`,
        `${now}  [WORKER] Watch rewards: AI Tasks Cleared -> ZK Proof Wins -> Live Balance`,
        ...prev,
      ].slice(0, 200),
    );
    appendLedger([
      "[Worker] Start Mining (GPU) pressed — Worker Daemon earning flow armed.",
      "[Worker] Keep tet-core worker daemon running; successful AI jobs settle as TET rewards.",
    ]);
  }

  const balanceTetDisplay =
    balanceStevemon == null ? "—" : formatStevemonToTetDisplay(balanceStevemon);
  const balanceStevemonDisplay =
    balanceStevemon == null ? "—" : balanceStevemon.toLocaleString("en-US");
  const sendAmountStevemon = parseTet(sendAmountTet);
  const sendAmountStevemonDisplay =
    sendAmountStevemon == null ? "" : `(${sendAmountStevemon.toLocaleString("en-US")} Stevemon)`;
  const sendFeeBreakdown =
    sendAmountStevemon != null && sendAmountStevemon > 0n
      ? tetTransferFeeBreakdown(sendAmountStevemon)
      : null;
  const networkComputeTflopsLabel = useMemo(() => {
    if (networkTflops != null && Number.isFinite(networkTflops)) return networkTflops.toFixed(1);
    if (statusWorkers != null && statusWorkers >= 0) return (statusWorkers * 12.4).toFixed(1);
    return "—";
  }, [networkTflops, statusWorkers]);

  const activeIdentityLabel = "Session signer";

  const aiEscrowEstimateStevemon = useMemo(
    () => (aiTaskPrompt.trim().length > 0 ? AI_TASK_DISPLAY_ESCROW_MICRO : 0n),
    [aiTaskPrompt],
  );

  const sendTransferButtonLabel = !isSignerReady
    ? "Unlock Wallet…"
    : sendTransferPhase === "signing"
      ? "Signing…"
      : sendTransferPhase === "submitting"
        ? "Submitting…"
        : sendingTx
          ? "Processing…"
          : "Send";

  const sendCoinsFields = (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="w-20">From:</span>
        <span
          className={`${inset} flex-1 ${field} px-2 py-1 text-xs font-mono text-black/80 truncate`}
          title={founderWalletIdHex64}
        >
          {normalizeWalletId64(founderWalletIdHex64) || "—"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20">Pay To:</span>
        <input
          value={sendTo}
          onChange={(e) => setSendTo(e.target.value)}
          className={`${inset} flex-1 ${field} px-2 py-1 text-sm font-mono outline-none`}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-20">Amount:</span>
        <input
          value={sendAmountTet}
          onChange={(e) => setSendAmountTet(e.target.value)}
          className={`${inset} w-40 ${field} px-2 py-1 text-sm font-mono outline-none`}
          placeholder="0.001"
        />
        <span className="text-sm">TET</span>
        {sendAmountStevemonDisplay ? (
          <span className="text-xs text-black/70">{sendAmountStevemonDisplay}</span>
        ) : null}
      </div>
      {sendFeeBreakdown ? (
        <div className="text-xs text-black/75 pl-[5.5rem] leading-snug">
          Net to recipient: {formatStevemonToTetDisplay(sendFeeBreakdown.netToRecipient)} TET · Fee (1%):{" "}
          {formatStevemonToTetDisplay(sendFeeBreakdown.feeTotal)} TET (½ founder · ½ burn)
        </div>
      ) : null}
      <div className="flex items-start gap-2">
        <span className="w-20 pt-1">Message:</span>
        <div className="flex-1">
          <input
            value={sendMessage}
            onChange={(e) => setSendMessage(e.target.value.slice(0, 64))}
            maxLength={64}
            className={`${inset} w-full ${field} px-2 py-1 text-sm outline-none`}
            placeholder="(Optional local note, not on-chain)"
          />
          <div className="mt-1 text-xs text-black/70">{sendMessage.length} / 64</div>
        </div>
      </div>
      {sendTransferUserMsg ? (
        <div
          className={`text-xs pl-[5.5rem] leading-snug ${
            sendTransferPhase === "confirmed"
              ? "text-[#0b5c2e] font-medium"
              : sendTransferPhase === "failed"
                ? "text-red-800 font-medium"
                : "text-black/75"
          }`}
          role="status"
        >
          {sendTransferUserMsg}
        </div>
      ) : null}
      <div className="pt-2">
        <button
          type="button"
          disabled={sendingTx || !isSignerReady}
          onClick={() => void onSendCoins()}
          className={`${winBtn} ${panel} px-4 py-1 text-sm max-w-full text-left ${sendingTx ? "text-xs" : ""}`}
        >
          {sendTransferButtonLabel}
        </button>
      </div>
    </div>
  );

  if (!desktopViewport) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 font-mono text-[#39ff88]">
        <div className="max-w-md text-center text-sm tracking-wide">
          [!] TET-OS requires a Desktop environment. Please open on a PC.
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen bg-[#D6D4CE] text-black font-mono"
    >
      {menuOpen || anyModalOpen ? (
        <div
          className="fixed inset-0 z-30"
          onMouseDown={() => {
            if (aboutOpen) return;
            if (manualOpen) return;
            setMenuOpen(null);
          }}
          aria-hidden="true"
        />
      ) : null}
      {/* Main window frame (slightly rounded) */}
      <div
        className={`m-2 rounded-sm ${face} border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] overflow-hidden h-[calc(100vh-16px)] flex flex-col`}
      >
        {/* Title bar */}
        <div className="bg-[#000080] text-white px-2 py-1 text-sm font-bold [text-rendering:optimizeSpeed] [-webkit-font-smoothing:auto] flex items-center gap-2">
          <span>tet-core v0.1</span>
          <button
            type="button"
            title={TET_WHITEPAPER_TITLE}
            onClick={() => setWhitepaperOpen(true)}
            className="ml-1 rounded-sm border border-white/40 bg-[#000060] px-1.5 py-0.5 text-xs font-mono hover:bg-[#101878]"
          >
            Whitepaper.txt
          </button>
          <span className="flex-1" aria-hidden="true" />
          {walletGate === "ready" ? (
            <button
              type="button"
              onClick={() => lockWalletSession()}
              className="rounded-sm border border-white/40 bg-[#000060] px-2 py-0.5 text-xs font-mono hover:bg-[#101878] shrink-0"
            >
              Lock Wallet
            </button>
          ) : null}
        </div>

        {welcomeAirdropBanner ? (
          <div
            className={`${inset} mx-2 mt-1 flex items-center justify-between gap-2 bg-[#e8f5e9] px-3 py-2 text-sm text-[#1b5e20]`}
            role="status"
          >
            <span className="font-medium">{welcomeAirdropBanner}</span>
            <button
              type="button"
              className={`${winBtn} shrink-0 bg-[#c0c0c0] px-2 py-0.5 text-xs`}
              onClick={() => setWelcomeAirdropBanner(null)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {/* Network supply / mining pool — Win98 inset panel (matches app chrome) */}
        <div
          className={`${inset} bg-[#c0c0c0] px-3 py-2 text-sm text-black ${
            syncUi.panelGreenTint ? "shadow-[inset_0_0_0_1px_rgba(42,255,154,0.35)]" : ""
          }`}
        >
          <div className="flex flex-wrap gap-x-6 gap-y-1 items-baseline justify-between">
            <span className="min-w-0 max-w-full truncate">
              <span className={syncUi.dotClass} aria-hidden />
              Total network supply:{" "}
              <span className="tabular-nums font-semibold" title={totalSupplyStevemon != null ? `${formatStevemonToTetFullDisplay(totalSupplyStevemon)} TET` : totalSupply}>
                {totalSupplyStevemon != null ? formatStevemonToTetCompact(totalSupplyStevemon) : totalSupply}
              </span>{" "}
              TET
              {totalSupplyStevemon != null ? (
                <span className="text-[#2a4a3a] font-medium hidden xl:inline">
                  {" "}
                  (<span className="tabular-nums">{formatStevemonDisplay(totalSupplyStevemon)}</span> Stevemon)
                </span>
              ) : null}
            </span>
            <span className="min-w-0 max-w-full truncate">
              Worker pool (ledger):{" "}
              <span
                className="tabular-nums font-semibold"
                title={workerPoolBalanceStevemon !== null ? `${formatStevemonToTetFullDisplay(workerPoolBalanceStevemon)} TET` : undefined}
              >
                {workerPoolBalanceStevemon !== null ? formatStevemonToTetCompact(workerPoolBalanceStevemon) : "—"}
              </span>{" "}
              TET
              {workerPoolBalanceStevemon != null ? (
                <span className="text-[#2a4a3a] font-medium hidden xl:inline">
                  {" "}
                  (<span className="tabular-nums">{formatStevemonDisplay(workerPoolBalanceStevemon)}</span>{" "}
                  Stevemon)
                </span>
              ) : null}
            </span>
          </div>
          <div className="mt-1 font-mono text-[10px] text-black/65">
            API: {baseUrl} · {syncUi.pollingHint}
            {ledgerState?.state_root ? (
              <>
                {" "}
                · root{" "}
                <span className="font-mono" title={ledgerState.state_root}>
                  {ledgerState.state_root.length > 14
                    ? `${ledgerState.state_root.slice(0, 10)}…`
                    : ledgerState.state_root}
                </span>
              </>
            ) : null}
          </div>
          {syncUi.detailLines.length > 0 ? (
            <div className="mt-0.5 font-mono text-[10px] text-black/70 space-y-0.5">
              {syncUi.detailLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          ) : null}
          <div className="mt-1 text-sm text-black tabular-nums leading-snug">
            [THERMODYNAMIC BURN]{" "}
            <span className="text-[10px] font-sans text-black/55 normal-case">(network total)</span> Extinguished:{" "}
            {networkBurnedStevemon != null ? (
              <>
                <span className="font-mono font-semibold">
                  {formatStevemonToTetCompact(networkBurnedStevemon)}
                </span>{" "}
                TET
                <span className="text-[#2a4a3a] font-medium font-sans hidden xl:inline">
                  {" "}
                  (
                  <span className="tabular-nums font-mono">{formatStevemonDisplay(networkBurnedStevemon)}</span>{" "}
                  Stevemon)
                </span>
              </>
            ) : (
              <span className="font-mono">—</span>
            )}
          </div>
        </div>

        {/* Header + menus */}
        <div className={`px-2 py-1 text-sm ${face} relative z-50`} ref={menuBarRef}>
          <div className="mt-0.5 flex items-center gap-1 relative">
            <MenuButton id="File" />
            <MenuButton id="Options" />
            <MenuButton id="Help" />

            <div className="relative">
              <MenuDropdown
                id="File"
                items={[
                  {
                    label: "Wallet…",
                    onClick: () => {
                      setWalletUnlockErr("");
                      setWalletUnlockOpen(true);
                    },
                  },
                  { label: "Backup Wallet", onClick: () => setBackupOpen(true) },
                  {
                    label: "Lock wallet",
                    onClick: () => {
                      lockWalletSession();
                    },
                  },
                  {
                    label: "Exit",
                    onClick: () => {
                      setHybridSignerSession(null);
                      clearSession();
                      router.push("/");
                    },
                  },
                ]}
              />
            </div>
            <div className="relative">
              <MenuDropdown
                id="Options"
                items={[
                  {
                    label: "Change PIN",
                    onClick: () => {
                      setPinCur("");
                      setPinNew("");
                      setPinNew2("");
                      setPinErr("");
                      setPinOk("");
                      setChangePinOpen(true);
                    },
                  },
                  { label: "Network Settings", onClick: () => setNetworkOpen(true) },
                ]}
              />
            </div>
            <div className="relative">
              <MenuDropdown
                id="Help"
                items={[
                  {
                    label: "How to Use TET",
                    onClick: () => {
                      setManualOpen(true);
                    },
                  },
                  {
                    label: "About TET v0.1",
                    onClick: () => {
                      setAboutOpen(true);
                    },
                  },
                  {
                    label: "TET Network Whitepaper",
                    onClick: () => setWhitepaperOpen(true),
                  },
                ]}
              />
            </div>

            <div className="ml-auto">
              <button
                type="button"
                onClick={() => {
                  clearSession();
                  router.push("/");
                }}
                className={`${winBtn} ${panel} px-2 py-0.5 text-sm`}
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-end gap-1 px-2 pt-2 overflow-x-auto">
          <TabButton id="Transactions" />
          <TabButton id="Send Coins" />
          <TabButton id="Inbox / Receive" />
          <TabButton id="Messages" />
          <TabButton id="Address Book" />
          <TabButton id="AI Task Terminal" />
          <TabButton id="Explorer" />
          <TabButton id="Worker" />
        </div>

        {/* Main layout — scroll above status bar; bottom padding so SEND PROMPT clears the bar */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 px-3 pt-2 pb-28 md:pb-32 flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
          {/* Left pane */}
          <section className="space-y-3 min-h-0">
            <div className={`${outset} ${panel} p-3`}>
              <div className="mb-2">
                <div className="text-sm font-semibold text-black">AI Task Terminal</div>
                <div className="text-[11px] text-black/70 mt-1 font-mono">
                  CAAC: local {visionCaacRole} · network {networkCaacLine}
                </div>
              </div>
              <div className="text-sm font-mono text-black">
                Balance: {balanceTetDisplay} TET ({balanceStevemonDisplay} Stevemon)
                {walletInferenceBurnStevemon != null ? (
                  <span className="text-[11px] text-black/75">
                    {" "}
                    · Burned (ledger, this wallet):{" "}
                    <span className="font-mono font-semibold tabular-nums text-black/90">
                      {formatStevemonToTetFullDisplay(walletInferenceBurnStevemon)}
                    </span>{" "}
                    TET
                    <span className="text-[#2a4a3a] font-medium font-sans">
                      {" "}
                      (
                      <span className="tabular-nums font-mono">
                        {formatStevemonDisplay(walletInferenceBurnStevemon)}
                      </span>{" "}
                      Stevemon)
                    </span>
                  </span>
                ) : null}
              </div>
              <div className="mt-2">
                <div className="text-sm mb-1">Wallet ID:</div>
                <div className={`${inset} ${field} px-2 py-1 text-sm font-mono break-all`}>{founderWalletIdHex64}</div>
              </div>
              <div className="mt-2">
                <div className="text-sm mb-1">Address (signer):</div>
                <div className={`${inset} ${field} px-2 py-1 text-sm font-mono`}>{activeAccountAddress}</div>
              </div>
            </div>

          <div className="min-h-0 space-y-3">
          {tab === "Transactions" ? (
            <div className={`${outset} ${panel} p-3`}>
              <div className="text-sm mb-2 flex flex-wrap items-center gap-2">
                <span>Recent Transactions</span>
                <button
                  type="button"
                  onClick={() => clearTxHistoryStorage()}
                  className={`${winBtn} ${panel} px-2 py-0.5 text-xs`}
                >
                  Clear history
                </button>
              </div>
              <div className={`${inset} ${field} p-2 text-sm`}>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="text-left font-normal pb-1">Date</th>
                      <th className="text-left font-normal pb-1">Type</th>
                      <th className="text-left font-normal pb-1">Address</th>
                      <th className="text-left font-normal pb-1">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    {txHistory.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-2 font-sans text-sm">
                          (no transactions)
                        </td>
                      </tr>
                    ) : (
                      txHistory.slice(0, 30).map((r, idx) => (
                        <tr key={idx}>
                          <td className="pr-3 py-0.5 font-sans text-xs">{r.date}</td>
                          <td className="pr-3 py-0.5">{r.type}</td>
                          <td className="pr-3 py-0.5">{r.address}</td>
                          <td className="py-0.5">
                            <div>{r.amount}</div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : tab === "Send Coins" ? (
            <div className={`${outset} ${panel} p-3`}>
              <div className="text-sm mb-2">Send Coins</div>
              {sendCoinsFields}
            </div>
          ) : tab === "Inbox / Receive" ? (
            <div
              className={`${outset} rounded-none border-2 border-t-white border-l-white border-b-[#404040] border-r-[#404040] bg-[#c0c0c0] p-2 flex flex-col flex-1 min-h-0 min-w-0`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2 px-0.5">
                <span className="text-sm font-bold text-black">Outlook Express — Inbox (simulated)</span>
                <span className="text-[10px] font-mono font-bold text-black tracking-wide">[ZK VERIFIED]</span>
              </div>

              <div className="mb-2 shrink-0 border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] bg-[#c0c0c0] p-2">
                <div className="text-xs font-semibold text-black mb-1">Receive Coins (My Address)</div>
                <div className="text-[11px] text-black/80 mb-1">L1 SS58 — share with senders for memo transfers.</div>
                <div className={`${inset} bg-[#FFFFFF] px-1.5 py-1 text-xs font-mono text-black break-all`}>
                  {activeAccountAddress}
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    className={`${winBtn} bg-[#c0c0c0] px-3 py-1 text-xs text-black`}
                    onClick={() => {
                      void (async () => {
                        try {
                          await navigator.clipboard.writeText(activeAccountAddress);
                          setInboxAddressCopied(true);
                          window.setTimeout(() => setInboxAddressCopied(false), 2200);
                        } catch {
                          appendLedger(["Inbox: clipboard unavailable"]);
                        }
                      })();
                    }}
                  >
                    {inboxAddressCopied ? "[OK] Copied" : "Copy address"}
                  </button>
                </div>
              </div>

              <div className="flex flex-col flex-1 min-h-[min(52vh,420px)] min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1 px-0.5 shrink-0">
                  <span className="text-xs font-semibold text-black">Inbox (Messages)</span>
                  <button
                    type="button"
                    className={`${winBtn} bg-[#c0c0c0] px-2 py-0.5 text-xs text-black`}
                    onClick={() => clearInboxForRecipient(activeIdentityPubkeyNorm)}
                  >
                    Clear inbox
                  </button>
                </div>
                <div
                  className={`${inset} flex-1 min-h-0 overflow-auto bg-[#FFFFFF] border-2 border-t-[#808080] border-l-[#808080] border-b-white border-r-white`}
                >
                  <table className="w-full border-collapse text-xs font-mono text-black">
                    <thead>
                      <tr className="bg-[#c0c0c0] border-b-2 border-[#808080] text-left">
                        <th className="font-normal p-1.5 border-r border-[#808080] w-[130px]">Received</th>
                        <th className="font-normal p-1.5 border-r border-[#808080] min-w-[100px]">From</th>
                        <th className="font-normal p-1.5 border-r border-[#808080] w-[100px]">Amount</th>
                        <th className="font-normal p-1.5">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inboxForIdentity.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-3 text-sm font-sans text-black/55 align-top">
                            No incoming MemoSent events for this identity yet (live while OS is open).
                          </td>
                        </tr>
                      ) : (
                        inboxForIdentity.map((m) => (
                          <tr key={m.id} className="border-b border-[#d0d0d0] align-top">
                            <td className="p-1.5 whitespace-nowrap align-top text-[11px]">
                              {new Date(m.receivedAtMs).toLocaleString()}
                            </td>
                            <td className="p-1.5 align-top break-all text-[11px]">{m.fromSs58}</td>
                            <td className="p-1.5 whitespace-nowrap align-top">{m.grossTetDisplay} TET</td>
                            <td className="p-1.5 align-top break-words [overflow-wrap:anywhere] text-[11px]">
                              {m.memo || "—"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : tab === "Messages" ? (
            <div className={`${outset} ${panel} p-3 flex flex-col gap-3`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-bold text-black">Sovereign Messages — E2EE (Tmail)</span>
                <span className="text-[10px] font-mono font-bold text-black tracking-wide">
                  [X25519 + ML-KEM + ChaCha20]
                </span>
              </div>

              {/* A. Compose */}
              <div className={`${inset} bg-[#c0c0c0] p-2`}>
                <div className="text-xs font-semibold text-black mb-1">Compose</div>
                <label className="block text-[11px] text-black/80 mb-0.5">Recipient wallet ID (64 hex)</label>
                <input
                  type="text"
                  spellCheck={false}
                  value={tmailRecipient}
                  onChange={(e) => setTmailRecipient(e.target.value)}
                  placeholder="0000…"
                  className={`${inset} w-full bg-white px-1.5 py-1 text-xs font-mono text-black mb-2`}
                />
                <label className="block text-[11px] text-black/80 mb-0.5">
                  Message ({new TextEncoder().encode(tmailBody).length}/{TMAIL_BODY_MAX} bytes)
                </label>
                <textarea
                  value={tmailBody}
                  onChange={(e) => setTmailBody(e.target.value)}
                  rows={4}
                  placeholder="Your end-to-end encrypted message…"
                  className={`${inset} w-full bg-white px-1.5 py-1 text-xs font-mono text-black resize-y`}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={tmailSending || walletGate !== "ready" || !tmailKeys}
                    className={`${winBtn} bg-[#c0c0c0] px-3 py-1 text-xs text-black disabled:opacity-50`}
                    onClick={() => void sendTmailMessage()}
                  >
                    {tmailSending ? "Sending…" : "Send Encrypted Message"}
                  </button>
                  {tmailComposeMsg ? (
                    <span className="text-[11px] text-black/80 break-words">{tmailComposeMsg}</span>
                  ) : null}
                </div>
              </div>

              {/* B. Inbox */}
              <div className={`${inset} bg-[#c0c0c0] p-2`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-black">Inbox (decrypted on this device)</span>
                  <span className="text-[10px] font-mono text-black/60">{tmailInbox.length} msg</span>
                </div>
                {!tmailKeys ? (
                  <div className="text-[11px] text-black/55 p-2">
                    Messaging keys unavailable for this wallet type.
                  </div>
                ) : tmailInbox.length === 0 ? (
                  <div className="text-[11px] text-black/55 p-2">
                    No messages yet (polling every 5s while this tab is open).
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {(tmailShowAll ? tmailInbox : tmailInbox.slice(0, TMAIL_INBOX_VISIBLE)).map((m) => (
                      <div
                        key={m.msgId}
                        className={`${outset} bg-white px-2 py-1.5 text-black`}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2 text-[10px] font-mono text-black/60">
                          <span className="break-all">from {m.sender.slice(0, 16)}…</span>
                          <span>{new Date(m.sentAtMs).toLocaleString()}</span>
                        </div>
                        <div className="text-xs whitespace-pre-wrap break-words [overflow-wrap:anywhere] mt-0.5">
                          {m.plaintext}
                        </div>
                      </div>
                    ))}
                    {tmailInbox.length > TMAIL_INBOX_VISIBLE ? (
                      <button
                        type="button"
                        className={`${winBtn} bg-[#c0c0c0] px-2 py-0.5 text-xs text-black self-start`}
                        onClick={() => setTmailShowAll((v) => !v)}
                      >
                        {tmailShowAll
                          ? "Show fewer"
                          : `Show older (${tmailInbox.length - TMAIL_INBOX_VISIBLE} hidden)`}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>

              {/* C. Status */}
              <div className={`${inset} bg-[#c0c0c0] p-2`}>
                <div className="text-xs font-semibold text-black mb-1">Messaging Keys</div>
                {!tmailKeys ? (
                  <div className="text-[11px] text-black/55">
                    This wallet type does not expose a mnemonic, so messaging keys can&apos;t be derived.
                  </div>
                ) : tmailKeyStatus === "registered" && tmailKeysRegisteredAtMs ? (
                  <div className="text-[11px] text-black/80">
                    Keys registered at: {new Date(tmailKeysRegisteredAtMs).toLocaleString()}
                  </div>
                ) : tmailKeyStatus === "registering" ? (
                  <div className="text-[11px] text-black/80">Publishing keys…</div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-black/80">
                      {tmailKeyStatus === "error"
                        ? "Key registration failed."
                        : "Your messaging keys are not registered yet."}
                    </span>
                    <button
                      type="button"
                      disabled={walletGate !== "ready"}
                      className={`${winBtn} bg-[#c0c0c0] px-3 py-1 text-xs text-black disabled:opacity-50`}
                      onClick={() => void registerTmailKeysNow()}
                    >
                      Register your messaging keys
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : tab === "Address Book" ? (
            <AddressBookPanel
              outset={outset}
              inset={inset}
              winBtn={winBtn}
              entries={addrBook}
              onAdd={onAddAddress}
            />
          ) : tab === "AI Task Terminal" ? (
            <div className={`${outset} ${panel} p-2 flex h-[min(72vh,700px)] min-h-[520px] flex-col overflow-hidden`}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                <div>
                  <div className="text-sm font-semibold text-black">TET-Network Chat</div>
                  <div className="text-[11px] text-black/60">
                    Ask naturally. Distributed compute, proof, and settlement happen behind the scenes.
                  </div>
                </div>
                <div className={`${inset} ${field} px-2 py-1 text-[11px] font-mono text-black/70`}>
                  Block {bestNumber == null ? "—" : bestNumber.toLocaleString("en-US")} · Workers {statusWorkers ?? "—"}
                </div>
              </div>

              <div
                ref={aiChatScrollRef}
                className={`${inset} flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[#f5f3ea] p-3 text-sm`}
              >
                <div className="mx-auto flex max-w-3xl flex-col gap-3">
                  {aiChatMessages.map((m) => {
                    const isUser = m.role === "user";
                    return (
                      <div key={m.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                        <div
                          className={[
                            "max-w-[86%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 shadow-sm",
                            isUser
                              ? "bg-[#000080] text-white rounded-br-sm"
                              : m.status === "error"
                                ? "bg-[#fff1f1] text-[#7a1010] border border-[#d28a8a] rounded-bl-sm"
                                : "bg-white text-black border border-black/10 rounded-bl-sm",
                          ].join(" ")}
                        >
                          <div className="mb-1 text-[10px] font-mono opacity-65">
                            {isUser ? "You" : "TET-Network"} · {m.ts > 0 ? new Date(m.ts).toLocaleTimeString() : "ready"}
                          </div>
                          <div className="leading-relaxed">{m.text}</div>
                          {m.status === "queued" ? (
                            <div className="mt-2 text-[11px] font-mono text-[#0b5c2e]">
                              L1 accepted · proof settlement pending
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {aiTaskSubmitting ? (
                    <div className="flex justify-start">
                      <div className="max-w-[86%] rounded-2xl rounded-bl-sm border border-[#00a0a0]/30 bg-white px-4 py-3 text-black shadow-sm">
                        <div className="mb-2 text-[10px] font-mono text-black/55">TET-Network</div>
                        <div className="space-y-1.5 font-mono text-xs">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 animate-pulse rounded-full bg-[#000080]" />
                            Waiting for Network Compute...
                          </div>
                          <div className="flex items-center gap-2 text-black/70">
                            <span className="h-2 w-2 animate-pulse rounded-full bg-[#008080] [animation-delay:160ms]" />
                            Dispatching to worker mesh...
                          </div>
                          <div className="flex items-center gap-2 text-black/60">
                            <span className="h-2 w-2 animate-pulse rounded-full bg-[#0b5c2e] [animation-delay:320ms]" />
                            ZK Proving...
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void onSubmitAiTaskRequest();
                }}
                className={`${outset} ${panel} mt-2 shrink-0 p-2`}
              >
                <div className="flex items-end gap-2">
                  <textarea
                    value={aiTaskPrompt}
                    onChange={(e) => setAiTaskPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void onSubmitAiTaskRequest();
                      }
                    }}
                    rows={2}
                    disabled={aiTaskSubmitting}
                    className={`${inset} ${field} min-h-[3rem] flex-1 resize-none px-3 py-2 text-sm outline-none`}
                    placeholder="Message TET-Network..."
                  />
                  <button
                    type="submit"
                    disabled={
                      aiTaskSubmitting || !isSignerReady || aiEscrowEstimateStevemon <= 0n || aiTaskPrompt.trim().length === 0
                    }
                    className={`${winBtn} ${panel} px-4 py-3 text-sm font-semibold disabled:opacity-50 disabled:active:translate-x-0 disabled:active:translate-y-0`}
                  >
                    {aiTaskSubmitting ? "Sending..." : "Send"}
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-black/50">
                  <span>
                    {isSignerReady ? "Wallet ready" : "Unlock wallet from File -> Wallet"} · Shift+Enter for newline
                  </span>
                  <span className="font-mono">
                    {stringToU8a(aiTaskPrompt).length} / {AI_PROMPT_MAX_BYTES} bytes
                    {lastAiDemandTaskId ? ` · last task ${lastAiDemandTaskId.slice(0, 12)}...` : ""}
                  </span>
                </div>
              </form>
            </div>
          ) : tab === "Explorer" ? (
            <div className={`${outset} ${panel} p-3 flex flex-col min-h-[min(74vh,620px)]`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div>
                  <div className="text-sm font-semibold text-black">TET Explorer</div>
                  <div className="text-[11px] text-black/65 mt-0.5 font-mono">
                    Unified OS window · blocks, tx hashes, and workload proofs stay inside TET-OS.
                  </div>
                </div>
                <div className="text-[11px] font-mono text-black/65">Core: {baseUrl}</div>
              </div>
              <form onSubmit={(e) => void onExplorerSearch(e)} className="mb-3 flex flex-col gap-2 sm:flex-row">
                <input
                  value={explorerQuery}
                  onChange={(e) => setExplorerQuery(e.target.value)}
                  className={`${inset} ${field} min-w-0 flex-1 px-2 py-1 text-sm font-mono outline-none`}
                  placeholder="Block height or 64-hex tx hash"
                />
                <button type="submit" disabled={explorerLoading} className={`${winBtn} ${panel} px-3 py-1 text-sm font-semibold`}>
                  {explorerLoading ? "Searching…" : "Search"}
                </button>
              </form>
              {explorerErr ? <div className="mb-2 text-sm font-mono text-red-800">{explorerErr}</div> : null}
              <div className={`${inset} ${field} flex-1 min-h-0 overflow-auto p-2`}>
                {explorerBlock ? (
                  <div className="space-y-3 text-sm">
                    <div className="font-semibold">Block #{explorerBlock.block.height}</div>
                    <div className="grid grid-cols-1 gap-2 text-xs font-mono md:grid-cols-2">
                      <div className={`${inset} bg-white p-2 break-all`}>block_id: {explorerBlock.block.block_id}</div>
                      <div className={`${inset} bg-white p-2 break-all`}>state_root: {explorerBlock.block.state_root}</div>
                      <div className={`${inset} bg-white p-2`}>tx_count: {explorerBlock.block.tx_count}</div>
                      <div className={`${inset} bg-white p-2`}>
                        time: {explorerBlock.block.ts_ms ? new Date(explorerBlock.block.ts_ms).toLocaleString() : "—"}
                      </div>
                    </div>
                    <div className="font-semibold">Transactions</div>
                    {explorerBlock.txs.length === 0 ? (
                      <div className="text-sm text-black/55">(coinbase-only block)</div>
                    ) : (
                      <table className="w-full border-collapse text-xs font-mono">
                        <tbody>
                          {explorerBlock.txs.map((tx) => (
                            <tr key={tx.hash} className="border-b border-black/10 align-top">
                              <td className="py-1 pr-2">#{tx.tx_index}</td>
                              <td className="py-1 pr-2 font-semibold">{tx.tx_kind}</td>
                              <td className="py-1 break-all">{shortHash(tx.hash, 14, 10)}</td>
                              <td className="py-1 pl-2 text-right">{tx.workload_flag === 1 ? "AI" : "STD"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ) : explorerTx ? (
                  <div className="space-y-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">Transaction</span>
                      <span className={`${inset} bg-white px-2 py-0.5 text-xs font-mono`}>{explorerTx.tx_kind}</span>
                      <span className={`${inset} bg-white px-2 py-0.5 text-xs font-mono`}>
                        {explorerTx.workload_flag === 1 ? "AI workload" : "standard"}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 text-xs font-mono md:grid-cols-2">
                      <div className={`${inset} bg-white p-2 break-all`}>hash: {explorerTx.hash}</div>
                      <div className={`${inset} bg-white p-2`}>block: #{explorerTx.block_height}</div>
                      <div className={`${inset} bg-white p-2`}>index: {explorerTx.tx_index}</div>
                      <div className={`${inset} bg-white p-2 break-all`}>signer: {explorerTx.signer_wallet}</div>
                    </div>
                    <pre className={`${inset} bg-white p-2 max-h-72 overflow-auto text-[11px] whitespace-pre-wrap break-words`}>
                      {JSON.stringify(explorerTx.tx, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className={`${outset} ${panel} p-2`}>
                        <div className="text-[11px] uppercase tracking-wide text-black/60">Latest Height</div>
                        <div className="mt-1 text-2xl font-mono font-bold">#{latestBlocks[0]?.height ?? "—"}</div>
                      </div>
                      <div className={`${outset} ${panel} p-2`}>
                        <div className="text-[11px] uppercase tracking-wide text-black/60">Total Supply</div>
                        <div
                          className="mt-1 truncate text-lg font-mono font-bold"
                          title={totalSupplyStevemon != null ? `${formatStevemonToTetFullDisplay(totalSupplyStevemon)} TET` : totalSupply}
                        >
                          {totalSupplyStevemon != null ? formatStevemonToTetCompact(totalSupplyStevemon) : totalSupply} TET
                        </div>
                      </div>
                      <div className={`${outset} ${panel} p-2`}>
                        <div className="text-[11px] uppercase tracking-wide text-black/60">Worker Pool</div>
                        <div
                          className="mt-1 truncate text-lg font-mono font-bold"
                          title={workerPoolBalanceStevemon !== null ? `${formatStevemonToTetFullDisplay(workerPoolBalanceStevemon)} TET` : undefined}
                        >
                          {workerPoolBalanceStevemon !== null ? `${formatStevemonToTetCompact(workerPoolBalanceStevemon)} TET` : "—"}
                        </div>
                      </div>
                    </div>
                    <table className="w-full border-collapse text-xs font-mono">
                      <thead>
                        <tr className="border-b-2 border-[#808080] text-left">
                          <th className="py-1 pr-2 font-normal">Height</th>
                          <th className="py-1 pr-2 font-normal">Block ID</th>
                          <th className="py-1 pr-2 font-normal">State Root</th>
                          <th className="py-1 text-right font-normal">Tx</th>
                        </tr>
                      </thead>
                      <tbody>
                        {latestBlocks.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-3 text-sm text-black/55">
                              No blocks yet.
                            </td>
                          </tr>
                        ) : (
                          latestBlocks.map((b) => (
                            <tr key={`${b.height}-${b.block_id}`} className="border-b border-black/10">
                              <td className="py-1 pr-2 font-bold">#{b.height}</td>
                              <td className="py-1 pr-2 break-all">{shortHash(b.block_id)}</td>
                              <td className="py-1 pr-2 break-all">{shortHash(b.state_root ?? "")}</td>
                              <td className="py-1 text-right">{b.tx_count}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : tab === "Worker" ? (
            <div className={`${outset} ${panel} p-3`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div>
                  <div className="text-sm font-semibold text-black">Worker</div>
                  <div className="text-[11px] text-black/65 mt-0.5 font-mono">
                    Mainnet miner console merged into the TET-OS desktop.
                  </div>
                </div>
                <div className={`${inset} ${field} px-2 py-1 text-xs font-mono`}>
                  CAAC: {networkCaacLine}
                </div>
              </div>
              {workerCockpitErr ? <div className="mb-2 text-sm font-mono text-red-800">{workerCockpitErr}</div> : null}
              <div className={`${inset} ${field} p-2 text-xs font-mono break-all mb-3`}>
                Wallet: {normalizeWalletId64(founderWalletIdHex64) || "unlock required"} · Refresh: 5s
                {workerCockpitUpdatedAt ? ` · Last pulse: ${new Date(workerCockpitUpdatedAt).toLocaleTimeString()}` : ""}
                {workerCockpitLoading ? " · syncing…" : ""}
              </div>
              <button
                type="button"
                onClick={onStartMiningGpu}
                className={[
                  "mb-3 w-full rounded-none border-2 px-3 py-3 text-left font-mono",
                  "border-t-white border-l-white border-b-[#404040] border-r-[#404040]",
                  "bg-[#101010] text-[#d7d7d7]",
                  "shadow-[inset_0_0_0_1px_rgba(0,255,128,0.18)] active:border-t-[#404040] active:border-l-[#404040] active:border-b-white active:border-r-white active:translate-x-px active:translate-y-px",
                ].join(" ")}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-base font-bold tracking-[0.08em]">Start Mining (GPU)</span>
                  <span className={miningOn ? "animate-pulse text-[#39ff88]" : "text-[#9a9a9a]"}>
                    {miningOn ? "[ WORKER ONLINE ]" : "[ ARM WORKER ]"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[#9a9a9a]">
                  Opens the local daemon channel for AI workload routing, proof generation, and L1 settlement.
                </div>
              </button>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className={`${outset} ${panel} p-3`}>
                  <div className="text-[11px] uppercase tracking-wide text-black/60">Live Balance</div>
                  <div className="mt-1 text-2xl font-mono font-bold">
                    {workerCockpit ? formatWorkerTet(workerCockpit.balance_micro) : "0 TET"}
                  </div>
                </div>
                <div className={`${outset} ${panel} p-3`}>
                  <div className="text-[11px] uppercase tracking-wide text-black/60">Estimated Rewards</div>
                  <div className="mt-1 text-2xl font-mono font-bold">
                    {workerCockpit ? formatWorkerTet(workerCockpit.estimated_total_rewards_micro) : "0 TET"}
                  </div>
                </div>
                <div className={`${outset} ${panel} p-3`}>
                  <div className="text-[11px] uppercase tracking-wide text-black/60">AI Tasks Cleared</div>
                  <div className="mt-1 text-2xl font-mono font-bold">{workerCockpit?.processed_task_count ?? 0}</div>
                </div>
                <div className={`${outset} ${panel} p-3`}>
                  <div className="text-[11px] uppercase tracking-wide text-black/60">ZK Proof Wins</div>
                  <div className="mt-1 text-2xl font-mono font-bold">{workerCockpit?.zk_success_count ?? 0}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
                <div className={`${inset} ${field} p-2 text-sm`}>
                  <div className="font-semibold mb-1">Daemon Status</div>
                  <div className="font-mono text-xs">
                    state: {workerCockpit?.daemon.enabled ? "RUNNING" : "OFF"} · queue:{" "}
                    {workerCockpit?.daemon.current_task_count ?? 0} tasks · poll: {workerCockpit?.daemon.poll_ms ?? 0}ms
                  </div>
                </div>
                <div className={`${inset} ${field} p-2 text-sm`}>
                  <div className="font-semibold mb-1">Hardware Power</div>
                  <div className="font-mono text-xs">
                    {workerCockpit ? formatTflops(workerCockpit.hardware.tflops_est) : "0 TFLOPS"} · CPU{" "}
                    {workerCockpit?.hardware.cpu_logical_cores ?? 0} · RAM{" "}
                    {workerCockpit ? `${(workerCockpit.hardware.ram_total_bytes / 1024 ** 3).toFixed(1)}GiB` : "0GiB"} ·{" "}
                    {workerCockpit?.hardware.gpu_detected ? `GPU ${workerCockpit.hardware.gpu_hint}` : "CPU proving"}
                  </div>
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm select-none">
                <input type="checkbox" checked={miningOn} onChange={(e) => setMiningOn(e.target.checked)} />
                Local worker runtime enabled
              </label>
              <div className="mt-2 text-sm mb-1">Worker Log</div>
              <div className={`${inset} ${field} p-2 h-[24vh] overflow-auto text-xs font-mono whitespace-pre text-black`}>
                {miningLog.join("\n")}
              </div>
            </div>
          ) : null}
          </div>
          </section>

          {/* Right pane: Ledger always */}
          <section className={`${outset} ${panel} p-3 flex flex-col min-h-0`}>
            <div className="text-sm mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <span>The Thermodynamic Ledger</span>
              <span className="text-xs text-black/70">Signer: {activeIdentityLabel}</span>
            </div>
            <div
              ref={ledgerRef}
              className={`${inset} ${field} p-2 flex-1 min-h-0 overflow-auto text-xs font-mono text-black whitespace-pre`}
            >
              {ledger.join("\n")}
            </div>
          </section>
        </div>

        {/* Status bar (Windows classic) */}
        <div className="shrink-0 bg-[#D4D0C8] px-2 py-1 border-t border-l border-b border-r border-t-[#808080] border-l-[#808080] border-b-white border-r-white">
          <div className="flex gap-2 text-sm text-black font-sans">
            <div
              className={`flex-1 min-w-0 px-2 py-0.5 border border-t-[#808080] border-l-[#808080] border-b-white border-r-white rounded-none truncate font-mono text-xs`}
            >
              <span className={syncUi.badgeClass}>{syncUi.badgeText}</span>
              <span> · API: {baseUrl}</span>
              <span> · </span>
              <span>
                Connections: {connectedPeers ?? "—"} (Post-Quantum P2P)
              </span>
              <span className={statusSecurity.active ? " text-[#0b5c2e] font-semibold" : ""}>
                {" "}
                · {statusSecurity.label}
              </span>
              <span className="text-black font-sans text-sm">
                {" "}
                · Workers: {statusWorkers ?? "—"} · Network Compute: ~{networkComputeTflopsLabel} TFLOPS
              </span>
              <span
                className=" text-black/80 tabular-nums"
              >
                {" "}
                · Epoch: {networkEpoch ?? "—"}
              </span>
              <span className="text-black font-sans text-sm">
                {" "}
                · {pqcStatusShort}
              </span>
            </div>
            <div className="w-[min(320px,38vw)] shrink-0 px-2 py-0.5 border border-t-[#808080] border-l-[#808080] border-b-white border-r-white rounded-none text-right font-mono text-xs leading-tight">
              Block: {bestNumber == null ? "—" : bestNumber.toLocaleString("en-US")} {syncUi.shortLabel}
            </div>
          </div>
        </div>
      </div>

      {walletUnlockOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-6"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-4xl max-h-[min(92vh,720px)] overflow-y-auto rounded-sm bg-[#D6D4CE] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] shadow-lg">
            <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-white font-bold">
              <div className="text-sm">
                {persistedWalletKind === "none" ? "Wallet — local signing (PQC)" : "Enter PIN to Unlock"}
              </div>
              {walletGate === "locked" && persistedWalletKind !== "none" ? (
                <span className="text-[10px] font-normal text-white/80 px-1">Required</span>
              ) : (
                <button
                  type="button"
                  className={`${winBtn} bg-[#DAD8D2] px-2 py-0 text-sm leading-none`}
                  onClick={() => setWalletUnlockOpen(false)}
                  aria-label="Close"
                >
                  X
                </button>
              )}
            </div>
            <div className="p-3 space-y-3 text-sm text-black">
              {walletUnlockErr ? (
                <div className="rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs font-mono text-red-900">
                  {walletUnlockErr}
                </div>
              ) : null}
              {persistedWalletKind === "none" ? (
                <div className="space-y-3">
                  <p className="text-xs text-black/80 leading-relaxed border-b border-black/10 pb-2">
                    No wallet file on this device yet. Choose{" "}
                    <strong className="text-black">Create</strong> for a new 12-word seed, or{" "}
                    <strong className="text-black">Import</strong> if you already have a mnemonic. Set a{" "}
                    <strong className="text-black">6–8 digit PIN</strong>; the mnemonic is encrypted with AES-GCM (PBKDF2)
                    and stored only as{" "}
                    <span className="font-mono">tet_wallet_keystore</span> — never as plaintext.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div
                      className={`${inset} ${field} p-3 flex flex-col gap-2 border-2 border-t-white border-l-white border-b-[#a0a0a0] border-r-[#a0a0a0]`}
                    >
                      <div className="text-sm font-bold text-[#000080] border-b border-black/10 pb-1">
                        Create New Wallet
                      </div>
                      <p className="text-[11px] text-black/70 leading-snug">
                        Generates a fresh BIP39 phrase. Write it on paper before continuing — anyone with these words
                        controls this identity.
                      </p>
                      <button
                        type="button"
                        disabled={walletBusy}
                        className={`${winBtn} ${panel} px-2 py-1.5 text-xs font-semibold w-fit`}
                        onClick={() =>
                          void (async () => {
                            setWalletBusy(true);
                            setWalletUnlockErr("");
                            try {
                              await cryptoWaitReady();
                              const m = await generateMnemonic12Polkadot();
                              setNewMnemonicDraft(m);
                            } catch (e: unknown) {
                              setWalletUnlockErr(e instanceof Error ? e.message : String(e));
                            } finally {
                              setWalletBusy(false);
                            }
                          })()
                        }
                      >
                        Generate 12-word phrase
                      </button>
                      {newMnemonicDraft ? (
                        <div className={`${outset} bg-[#fafaf6] p-2 font-mono text-[11px] break-words text-black max-h-28 overflow-y-auto`}>
                          {newMnemonicDraft}
                        </div>
                      ) : (
                        <div className="text-[11px] text-black/40 italic">Phrase appears here after you generate.</div>
                      )}
                      <label className="block text-[11px] font-semibold text-black">
                        PIN (6–8 digits)
                        <input
                          type="password"
                          inputMode="numeric"
                          autoComplete="new-password"
                          value={newWalletPin}
                          onChange={(e) => setNewWalletPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                          className={`${inset} mt-1 w-full bg-white px-2 py-1.5 font-mono text-sm`}
                          placeholder="e.g. 123456"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={walletBusy || newMnemonicDraft.trim().length === 0 || !isValidWalletPin(newWalletPin)}
                        className={`${winBtn} ${panel} mt-auto w-full py-2.5 text-sm font-bold`}
                        onClick={() => void onWalletCreateSave()}
                      >
                        Save &amp; unlock
                      </button>
                    </div>
                    <div
                      className={`${inset} ${field} p-3 flex flex-col gap-2 border-2 border-t-white border-l-white border-b-[#a0a0a0] border-r-[#a0a0a0]`}
                    >
                      <div className="text-sm font-bold text-[#000080] border-b border-black/10 pb-1">
                        Import Wallet (Mnemonic)
                      </div>
                      <p className="text-[11px] text-black/70 leading-snug">
                        Paste your existing 12-word recovery phrase, then choose a new PIN to encrypt the copy stored on
                        this device (you can reuse your old PIN if you prefer).
                      </p>
                      <label className="block text-[11px] font-semibold text-black">
                        12-word mnemonic
                        <textarea
                          value={importMnemonicInput}
                          onChange={(e) => setImportMnemonicInput(e.target.value)}
                          rows={5}
                          spellCheck={false}
                          className={`${inset} mt-1 w-full bg-white px-2 py-2 font-mono text-[12px] leading-relaxed resize-y min-h-[5.5rem]`}
                          placeholder="word1 word2 word3 … word12"
                        />
                      </label>
                      <div className="text-[10px] text-black/50 font-mono">
                        Words: {importMnemonicInput.trim() ? importMnemonicInput.trim().split(/\s+/).filter(Boolean).length : 0}{" "}
                        / 12
                      </div>
                      <label className="block text-[11px] font-semibold text-black">
                        PIN (6–8 digits, encrypts local copy)
                        <input
                          type="password"
                          inputMode="numeric"
                          autoComplete="new-password"
                          value={importWalletPin}
                          onChange={(e) => setImportWalletPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                          className={`${inset} mt-1 w-full bg-white px-2 py-1.5 font-mono text-sm`}
                          placeholder="e.g. 123456"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={
                          walletBusy ||
                          importMnemonicInput.trim().length === 0 ||
                          !isValidWalletPin(importWalletPin)
                        }
                        className={`${winBtn} ${panel} mt-auto w-full py-2.5 text-sm font-bold`}
                        onClick={() => void onWalletImportSave()}
                      >
                        Import &amp; unlock
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-black">Enter PIN to Unlock</p>
                  <p className="text-xs text-black/75 leading-snug">
                    {persistedWalletKind === "vault"
                      ? "Enter the same master password you used on /setup (8+ characters, not only digits)."
                      : persistedWalletKind === "legacy_plain"
                        ? "This device has a legacy wallet — enter your PIN (6–8 digits). It will upgrade to AES-GCM storage."
                        : "Encrypted wallet on this device — enter your 6–8 digit PIN. Keys stay in memory only after unlock."}
                  </p>
                  <input
                    type="password"
                    value={walletSecretInput}
                    onChange={(e) => setWalletSecretInput(e.target.value)}
                    className={`${inset} w-full ${field} px-2 py-1.5 font-mono text-sm`}
                    placeholder={
                      persistedWalletKind === "vault" ? "Master password" : "6–8 digit PIN"
                    }
                  />
                  <button
                    type="button"
                    disabled={walletBusy || walletSecretInput.trim().length === 0}
                    className={`${winBtn} ${panel} w-full py-2 text-sm font-semibold`}
                    onClick={() => void onWalletUnlockSubmit()}
                  >
                    {walletBusy ? "Unlocking…" : "Unlock"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {aboutOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-6"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl rounded-sm bg-[#D6D4CE] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] overflow-hidden">
            <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-white font-bold [text-rendering:optimizeSpeed] [-webkit-font-smoothing:auto]">
              <div className="text-sm">About TET v0.1</div>
              <button
                type="button"
                className={`${winBtn} bg-[#DAD8D2] px-2 py-0 text-sm leading-none`}
                onClick={() => setAboutOpen(false)}
                aria-label="Close"
              >
                X
              </button>
            </div>
            <div className="p-3">
              <div className={`${inset} ${field} p-3 h-[52vh] overflow-auto text-xs font-mono whitespace-pre-wrap text-black leading-relaxed`}>
{`TET Network v0.1
Thermodynamic Execution Tree

TET is an execution network for AI demand. Prompts are routed into a decentralized worker mesh, priced as physical compute, and settled on a thermodynamic L1 where useful inference consumes scarce ledger value.

Security model:
- Ed25519 signs the wallet identity and transaction envelope.
- ML-DSA signs the same canonical payload for post-quantum resistance.
- Chain ID, genesis hash, and monotonic nonces bind every signed action to one ledger history.

Execution model:
- Workers accept AI workload, produce receipts, and submit proof-linked settlement.
- ZK-Court and slashing paths punish invalid claims.
- Burn accounting turns compute into permanent supply pressure.

This is not a demo console. It is the operator shell for TET-Core.`}
              </div>
              <div className="flex justify-end pt-3">
                <button type="button" className={`${winBtn} bg-[#DAD8D2] px-6 py-1 text-sm`} onClick={() => setAboutOpen(false)}>
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {manualOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-6"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl rounded-sm bg-[#D4D0C8] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] overflow-hidden">
            <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-white font-bold [text-rendering:optimizeSpeed] [-webkit-font-smoothing:auto]">
              <div className="text-sm">TET Network - User Manual</div>
              <button
                type="button"
                className={`${winBtn} bg-[#DAD8D2] px-2 py-0 text-sm leading-none`}
                onClick={() => setManualOpen(false)}
                aria-label="Close"
              >
                X
              </button>
            </div>
            <div className="p-3 bg-[#D4D0C8]">
              <div className={`${inset} bg-white p-3 h-[52vh] overflow-auto text-xs font-mono whitespace-pre-wrap text-black leading-relaxed`}>
{`TET NETWORK v0.1 - OPERATOR MANUAL

1. WALLET / KEY MATERIAL
The 12-word mnemonic derives both signing domains used by TET-OS: Ed25519 for ledger identity and ML-DSA for post-quantum envelope authentication. The local PIN encrypts browser-resident key material only. Back up the mnemonic offline.

2. AI TASK TERMINAL
Submit natural language demand from the terminal. TET-OS fetches the current replay nonce from TET-Core, signs one canonical payload with Ed25519 and ML-DSA, then submits the workload for L1 settlement.

3. WORKER
The Worker tab is the local daemon cockpit. Arm the GPU worker channel to receive AI workload, generate receipts, and settle rewards through the thermodynamic execution path.

4. EXPLORER
Explorer reads blocks, transaction hashes, state roots, and workload flags directly from TET-Core. Use it to verify that inference and transfer activity are entering canonical ledger history.

5. SEND COINS
Transfers use the same wallet identity and ledger binding rules. Every state-changing action is nonce-bound and chain-bound to prevent replay across histories.

TET-OS is a desktop operator shell for the Thermodynamic Execution Tree.`}
              </div>
              <div className="flex justify-end pt-3">
                <button type="button" className={`${winBtn} bg-[#DAD8D2] px-6 py-1 text-sm`} onClick={() => setManualOpen(false)}>
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {backupOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-6"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-sm bg-[#D4D0C8] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] overflow-hidden">
            <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-white font-bold [text-rendering:optimizeSpeed] [-webkit-font-smoothing:auto]">
              <div className="text-sm">Wallet Backup</div>
              <button
                type="button"
                className={`${winBtn} bg-[#DAD8D2] px-2 py-0 text-sm leading-none`}
                onClick={() => setBackupOpen(false)}
                aria-label="Close"
              >
                X
              </button>
            </div>
            <div className="p-4 bg-[#D4D0C8]">
              <div className="flex gap-3 items-start">
                <div
                  className={[
                    "w-10 h-10 bg-[#DAD8D2] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] flex items-center justify-center",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  <div className="w-0 h-0 border-l-[8px] border-r-[8px] border-b-[14px] border-l-transparent border-r-transparent border-b-black relative top-[-1px]" />
                </div>
                <div className="text-sm">
                  wallet.dat has been securely saved to your local machine. Please keep your 12-word mnemonic safe.
                </div>
              </div>
              <div className="flex justify-end pt-4">
                <button
                  type="button"
                  className={`${winBtn} bg-[#DAD8D2] px-8 py-1 text-sm`}
                  onClick={() => setBackupOpen(false)}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {changePinOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-6"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-sm bg-[#D4D0C8] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] overflow-hidden">
            <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-white font-bold [text-rendering:optimizeSpeed] [-webkit-font-smoothing:auto]">
              <div className="text-sm">Change PIN</div>
              <button
                type="button"
                className={`${winBtn} bg-[#DAD8D2] px-2 py-0 text-sm leading-none`}
                onClick={() => closeChangePin()}
                aria-label="Close"
              >
                X
              </button>
            </div>
            <div className="p-4 bg-[#D4D0C8]">
              <div className={`${inset} bg-white p-2 text-xs font-mono text-black/75`}>
                Re-encrypts the local wallet vault. Active session keys remain loaded until the wallet is locked or the page is closed.
              </div>
              <div className="mt-3 space-y-3 text-sm font-mono">
                <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                  <div>Current PIN</div>
                  <input
                    value={pinCur}
                    onChange={(e) => setPinCur(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    className={`${inset} bg-white px-2 py-1 text-sm outline-none w-40 font-mono`}
                    inputMode="numeric"
                    type="password"
                    placeholder="6–8 digits"
                  />
                </div>
                <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                  <div>New PIN</div>
                  <input
                    value={pinNew}
                    onChange={(e) => setPinNew(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    className={`${inset} bg-white px-2 py-1 text-sm outline-none w-40 font-mono`}
                    inputMode="numeric"
                    type="password"
                    placeholder="6–8 digits"
                  />
                </div>
                <div className="grid grid-cols-[140px_1fr] items-center gap-2">
                  <div>Confirm New PIN</div>
                  <input
                    value={pinNew2}
                    onChange={(e) => setPinNew2(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    className={`${inset} bg-white px-2 py-1 text-sm outline-none w-40 font-mono`}
                    inputMode="numeric"
                    type="password"
                    placeholder="6–8 digits"
                  />
                </div>
                {pinErr ? <div className={`${inset} bg-[#fff1f1] px-2 py-1 text-sm text-red-800`}>{pinErr}</div> : null}
                {pinOk ? <div className={`${inset} bg-[#eef8ee] px-2 py-1 text-sm text-[#0b5c2e]`}>{pinOk}</div> : null}
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  disabled={
                    !(
                      isValidWalletPin(pinCur) &&
                      isValidWalletPin(pinNew) &&
                      pinNew === pinNew2
                    )
                  }
                  className={`${winBtn} bg-[#DAD8D2] px-6 py-1 text-sm disabled:opacity-60 disabled:active:translate-x-0 disabled:active:translate-y-0`}
                  onClick={() => void applyChangePin()}
                >
                  Apply
                </button>
                <button type="button" className={`${winBtn} bg-[#DAD8D2] px-6 py-1 text-sm`} onClick={() => closeChangePin()}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {networkOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-6"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl rounded-sm bg-[#D4D0C8] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] overflow-hidden">
            <div className="flex items-center justify-between bg-[#000080] px-2 py-1 text-white font-bold [text-rendering:optimizeSpeed] [-webkit-font-smoothing:auto]">
              <div className="text-sm">Network Configuration</div>
              <button
                type="button"
                className={`${winBtn} bg-[#DAD8D2] px-2 py-0 text-sm leading-none`}
                onClick={() => setNetworkOpen(false)}
                aria-label="Close"
              >
                X
              </button>
            </div>
            <div className="p-4 bg-[#D4D0C8]">
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-[170px_1fr] items-center gap-2">
                  <div>TET-Core REST</div>
                  <input disabled value={baseUrl} className={`${inset} bg-white px-2 py-1 text-sm font-mono text-black/80`} />
                </div>
                <div className="grid grid-cols-[170px_1fr] items-center gap-2">
                  <div>Active workers</div>
                  <input
                    disabled
                    value={statusWorkers == null ? "—" : String(statusWorkers)}
                    className={`${inset} bg-white px-2 py-1 text-sm font-mono text-black/80`}
                  />
                </div>
                <div className="grid grid-cols-[170px_1fr] items-start gap-2">
                  <div>PQC status</div>
                  <textarea
                    readOnly
                    rows={3}
                    value={pqcStatusShort}
                    className={`${inset} bg-white px-2 py-1 text-xs font-mono text-black/80 w-full resize-none`}
                  />
                </div>
              </div>
              <div className="flex justify-end pt-4">
                <button type="button" className={`${winBtn} bg-[#DAD8D2] px-8 py-1 text-sm`} onClick={() => setNetworkOpen(false)}>
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {whitepaperOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-6 py-6"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          {/* Notepad.exe-style shell: deep Win98 bevel */}
          <div className="w-full min-w-0 max-w-3xl max-h-[min(92vh,780px)] flex flex-col rounded-none bg-[#c0c0c0] border-[3px] border-t-white border-l-white border-b-[#404040] border-r-[#404040] shadow-[2px_2px_0_#00000026] overflow-hidden">
            <div className="flex items-center justify-between gap-2 bg-[#000080] px-2 py-1 text-white font-bold [text-rendering:optimizeSpeed] [-webkit-font-smoothing:auto] shrink-0">
              <div className="text-sm truncate min-w-0 pr-2">Whitepaper.txt — TET Network v0.1</div>
              <button
                type="button"
                className={`${winBtn} shrink-0 bg-[#c0c0c0] px-2 py-0 text-sm leading-none text-black`}
                onClick={() => setWhitepaperOpen(false)}
                aria-label="Close whitepaper"
              >
                X
              </button>
            </div>
            <div className="p-2 bg-[#c0c0c0] flex flex-col flex-1 min-h-0 min-w-0 border-t border-[#dfdfdf]">
              {/* Sunken client area = pure white like Notepad; word-wrap only, never horizontal scroll */}
              <div
                className={[
                  inset,
                  "flex-1 min-h-0 min-w-0 max-w-full overflow-y-auto overflow-x-hidden px-[3px] py-[2px]",
                  "bg-[#FFFFFF] text-black",
                  "text-[13px] leading-[1.22] tracking-normal",
                  "[font-smooth:none] [-webkit-font-smoothing:none] [-moz-osx-font-smoothing:unset]",
                  "[scrollbar-width:thin] [scrollbar-color:#808080_#d4d0c8]",
                  "[&::-webkit-scrollbar]:w-[14px] [&::-webkit-scrollbar-track]:bg-[#d4d0c8]",
                  "[&::-webkit-scrollbar-thumb]:rounded-none [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-t-white [&::-webkit-scrollbar-thumb]:border-l-white [&::-webkit-scrollbar-thumb]:border-b-[#808080] [&::-webkit-scrollbar-thumb]:border-r-[#808080] [&::-webkit-scrollbar-thumb]:bg-[#c0c0c0]",
                ].join(" ")}
                style={{
                  fontFamily: '"Courier New", Courier, "MS Gothic", monospace',
                  textRendering: "auto",
                }}
              >
                <pre className="m-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-[inherit] text-[inherit] select-text overflow-x-hidden">
                  {TET_WHITEPAPER_FULL_TEXT}
                </pre>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 shrink-0">
                <a
                  href="/tet-network-whitepaper.pdf"
                  download="tet-network-whitepaper.pdf"
                  className={`${winBtn} inline-flex items-center gap-1 bg-[#c0c0c0] px-3 py-1 text-sm text-black no-underline`}
                >
                  Download Full PDF
                </a>
                <button type="button" className={`${winBtn} bg-[#c0c0c0] px-8 py-1 text-sm text-black`} onClick={() => setWhitepaperOpen(false)}>
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function AddressBookPanel(props: {
  outset: string;
  inset: string;
  winBtn: string;
  entries: AddressBookEntryV0[];
  onAdd: (label: string, addr: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [addr, setAddr] = useState("");

  return (
    <div className={`${props.outset} bg-[#DAD8D2] p-3`}>
      <div className="text-sm mb-2">Address Book</div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-16">Label:</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={`${props.inset} flex-1 bg-[#F9F9F6] px-2 py-1 text-sm outline-none`} />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16">Address:</span>
          <input value={addr} onChange={(e) => setAddr(e.target.value)} className={`${props.inset} flex-1 bg-[#F9F9F6] px-2 py-1 text-sm font-mono outline-none`} />
        </div>
        <div className="pt-1">
          <button
            type="button"
            className={`${props.winBtn} bg-[#DAD8D2] px-4 py-1 text-sm`}
            onClick={() => {
              props.onAdd(label, addr);
              setLabel("");
              setAddr("");
            }}
          >
            Add
          </button>
        </div>
      </div>

      <div className="mt-3 text-sm mb-1">Entries</div>
      <div className={`${props.inset} bg-[#F9F9F6] p-2 text-sm`}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="text-left font-normal pb-1">Label</th>
              <th className="text-left font-normal pb-1">Address</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {props.entries.length === 0 ? (
              <tr>
                <td colSpan={2} className="py-2 font-sans text-sm">
                  (empty)
                </td>
              </tr>
            ) : (
              props.entries.map((e) => (
                <tr key={`${e.label}:${e.created_at_ms}`}>
                  <td className="pr-4 py-0.5">{e.label}</td>
                  <td className="py-0.5">{e.address}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

