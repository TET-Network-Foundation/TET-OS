"use client";

/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any */

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
  getVisionPqcStatus,
  getTmailKeys,
  getWorkerStats,
  normalizeWalletId64,
  postEnterpriseInference,
  postInitialAirdropClaim,
  postWalletTransfer,
  putTmailKeys,
  STEVEMON_PER_TET,
  tetCoreUrl,
} from "../lib/tet_core_http";
import {
  buildTransferEnvelope,
  userFacingTransferError,
} from "../lib/transfer";
import { fetchWorkerCockpit, type WorkerCockpitJson } from "../lib/worker_cockpit";
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
import MessagesPanel from "./MessagesPanel";
import TransactionsPanel from "./tabs/TransactionsPanel";
import AddressBookPanel from "./tabs/AddressBookPanel";
import SendCoinsPanel from "./tabs/SendCoinsPanel";
import AITaskTerminalPanel from "./tabs/AITaskTerminalPanel";
import ExplorerPanel from "./tabs/ExplorerPanel";
import WorkerPanel from "./tabs/WorkerPanel";
import InboxReceivePanel from "./tabs/InboxReceivePanel";
import FilesPanel from "./tabs/FilesPanel";
import Win95Window from "./components/Win95Window";
import Win95TabBar from "./components/Win95TabBar";
import Win95Menu from "./components/Win95Menu";
import WalletSummaryHeader from "./components/WalletSummaryHeader";
import WalletUnlockBody from "./components/WalletUnlockBody";
import NetworkStatusPanel from "./components/NetworkStatusPanel";
import StatusBar from "./components/StatusBar";
import TitleBar from "./components/TitleBar";
import LedgerConsole from "./components/LedgerConsole";
import { deriveTmailKeysFromMnemonic, buildTmailKeyRegistrationV1 } from "../lib/tmail_keys";
import { setTmailKeySession, getTmailKeySession } from "../lib/tmail_session";

type TabId =
  | "AI Task Terminal"
  | "Send Coins"
  | "Receive Coins"
  | "Messages"
  | "Files"
  | "Address Book"
  | "Transactions"
  | "Explorer"
  | "Worker";
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

function normalizeHexInput(raw: string): string {
  const s = raw.trim().toLowerCase();
  return s.startsWith("0x") ? s.slice(2) : s;
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

  const [tab, setTab] = useState<TabId>("AI Task Terminal");
  const [desktopViewport, setDesktopViewport] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 768px)").matches,
  );
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
  // Wallet id whose Tmail KEM keys are derived + held in the session (triggers auto-register).
  const [tmailKeysWallet, setTmailKeysWallet] = useState<string | null>(null);

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
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setDesktopViewport(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

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

  // Auto-register this wallet's Tmail KEM keys on unlock (once per wallet) so peers can mail it and
  // the Messages tab is send-ready before it is even opened. No-op if already registered.
  useEffect(() => {
    if (walletGate !== "ready") return;
    const wid = normalizeWalletId64(tmailKeysWallet ?? "");
    if (!wid) return;
    const ks = getTmailKeySession();
    if (!ks || ks.walletIdHex64 !== wid) return;
    let cancelled = false;
    void (async () => {
      try {
        const existing = await getTmailKeys(baseUrl, wid);
        if (cancelled) return;
        if (existing.ok && existing.registration) return; // already published
        if (!existing.ok && existing.status !== 404) return; // transient/offline — retry on next unlock
        const reg = await buildTmailKeyRegistrationV1({
          x25519_pub: ks.x25519_pub,
          mlkem_pub: ks.mlkem_pub,
          baseUrl,
        });
        if (cancelled) return;
        const r = await putTmailKeys(baseUrl, wid, reg);
        if (!cancelled && r.ok) {
          appendLedger(["[Tmail] Messaging keys registered (X25519 + ML-KEM-768)."]);
        }
      } catch {
        // ignore (offline / CORS) — Status section offers a manual Register button.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletGate, tmailKeysWallet, baseUrl]);

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
    setFounderWalletIdHex64(wid);
    setActiveAccountAddress(`${wid.slice(0, 10)}…${wid.slice(-8)}`);
    if (wid !== GENESIS_FOUNDER_WALLET_ID_HEX) {
      appendLedger([
        "[INFO] Active wallet_id differs from default genesis dev key — use this Wallet ID on tet-core (faucet / mint) for balances.",
      ]);
    }
    try {
      const km = await deriveTmailKeysFromMnemonic(phrase);
      setTmailKeySession({
        walletIdHex64: wid,
        x25519_sk: km.x25519_sk,
        x25519_pub: km.x25519_pub,
        mlkem_sk: km.mlkem_sk,
        mlkem_pub: km.mlkem_pub,
      });
      setTmailKeysWallet(wid);
    } catch {
      // Non-fatal: Messages tab stays disabled until KEM keys derive successfully.
      setTmailKeySession(null);
      setTmailKeysWallet(null);
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
    setTmailKeySession(null);
    setTmailKeysWallet(null);
    welcomeAirdropShownRef.current = false;
    setWelcomeAirdropBanner(null);
    setWalletGate("locked");
    setFounderWalletIdHex64("—");
    setActiveAccountAddress("—");
    setBalanceStevemon(null);
    setWalletSecretInput("");
    setWalletUnlockErr("");
    setWalletUnlockOpen(true);
    appendLedger(["[Wallet] Locked — hybrid signing cleared for this tab."]);
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
  const walletBurnTetFullDisplay =
    walletInferenceBurnStevemon != null ? formatStevemonToTetFullDisplay(walletInferenceBurnStevemon) : null;
  const walletBurnStevemonDisplay =
    walletInferenceBurnStevemon != null ? formatStevemonDisplay(walletInferenceBurnStevemon) : null;
  const netSupplyDisplay =
    totalSupplyStevemon != null ? formatStevemonToTetCompact(totalSupplyStevemon) : totalSupply;
  const netSupplyTitle =
    totalSupplyStevemon != null ? `${formatStevemonToTetFullDisplay(totalSupplyStevemon)} TET` : totalSupply;
  const netSupplyStevemonDisplay =
    totalSupplyStevemon != null ? formatStevemonDisplay(totalSupplyStevemon) : null;
  const netWorkerPoolDisplay =
    workerPoolBalanceStevemon !== null ? formatStevemonToTetCompact(workerPoolBalanceStevemon) : "—";
  const netWorkerPoolTitle =
    workerPoolBalanceStevemon !== null ? `${formatStevemonToTetFullDisplay(workerPoolBalanceStevemon)} TET` : undefined;
  const netWorkerPoolStevemonDisplay =
    workerPoolBalanceStevemon != null ? formatStevemonDisplay(workerPoolBalanceStevemon) : null;
  const netStateRootShort = ledgerState?.state_root
    ? ledgerState.state_root.length > 14
      ? `${ledgerState.state_root.slice(0, 10)}…`
      : ledgerState.state_root
    : null;
  const netStateRootFull = ledgerState?.state_root ?? null;
  const netBurnDisplay =
    networkBurnedStevemon != null ? formatStevemonToTetCompact(networkBurnedStevemon) : null;
  const netBurnStevemonDisplay =
    networkBurnedStevemon != null ? formatStevemonDisplay(networkBurnedStevemon) : null;
  const statusConnectionsDisplay = connectedPeers == null ? "—" : String(connectedPeers);
  const statusWorkersDisplay = statusWorkers == null ? "—" : String(statusWorkers);
  const statusEpochDisplay = networkEpoch == null ? "—" : String(networkEpoch);
  const statusBlockDisplay = bestNumber == null ? "—" : bestNumber.toLocaleString("en-US");
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
      {/* Main window frame (slightly rounded) */}
      <div
        className={`m-2 rounded-sm ${face} border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] overflow-hidden h-[calc(100vh-16px)] flex flex-col`}
      >
        {/* Title bar */}
        <TitleBar
          version="tet-core v0.1"
          whitepaperTitle={TET_WHITEPAPER_TITLE}
          onWhitepaperOpen={() => setWhitepaperOpen(true)}
          showLockWallet={walletGate === "ready"}
          onLockWallet={() => lockWalletSession()}
        />

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
        <NetworkStatusPanel
          panelGreenTint={syncUi.panelGreenTint}
          dotClass={syncUi.dotClass}
          totalSupplyDisplay={netSupplyDisplay}
          totalSupplyTitle={netSupplyTitle}
          totalSupplyStevemonDisplay={netSupplyStevemonDisplay}
          workerPoolDisplay={netWorkerPoolDisplay}
          workerPoolTitle={netWorkerPoolTitle}
          workerPoolStevemonDisplay={netWorkerPoolStevemonDisplay}
          baseUrl={baseUrl}
          pollingHint={syncUi.pollingHint}
          stateRootShort={netStateRootShort}
          stateRootFull={netStateRootFull}
          detailLines={syncUi.detailLines}
          burnDisplay={netBurnDisplay}
          burnStevemonDisplay={netBurnStevemonDisplay}
        />

        {/* Header + menus */}
        <div className={`px-2 py-1 text-sm ${face} relative z-50`}>
          <div className="mt-0.5 flex items-center gap-1 relative">
            <Win95Menu
              label="File"
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
            <Win95Menu
              label="Options"
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
            <Win95Menu
              label="Help"
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
        <Win95TabBar
          tabs={[
            { id: "AI Task Terminal" },
            { id: "Send Coins" },
            { id: "Receive Coins" },
            { id: "Messages" },
            { id: "Files" },
            { id: "Address Book" },
            { id: "Transactions" },
            { id: "Explorer" },
            { id: "Worker" },
          ]}
          activeTab={tab}
          onChange={(id) => setTab(id as TabId)}
        />

        {/* Main layout — scroll above status bar; bottom padding so SEND PROMPT clears the bar */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 px-3 pt-2 pb-28 md:pb-32 flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
          {/* Left pane */}
          <section className="space-y-3 min-h-0">
            <WalletSummaryHeader
              visionCaacRole={visionCaacRole}
              networkCaacLine={networkCaacLine}
              balanceTetDisplay={balanceTetDisplay}
              balanceStevemonDisplay={balanceStevemonDisplay}
              burnTetFullDisplay={walletBurnTetFullDisplay}
              burnStevemonDisplay={walletBurnStevemonDisplay}
              walletId={founderWalletIdHex64}
              signerAddress={activeAccountAddress}
            />

          <div className="min-h-0 space-y-3">
          {tab === "Transactions" ? (
            <TransactionsPanel rows={txHistory} onClear={clearTxHistoryStorage} />
          ) : tab === "Send Coins" ? (
            <SendCoinsPanel
              fromWalletId={founderWalletIdHex64}
              fromWalletDisplay={normalizeWalletId64(founderWalletIdHex64)}
              payTo={sendTo}
              onPayToChange={setSendTo}
              amount={sendAmountTet}
              onAmountChange={setSendAmountTet}
              amountStevemonDisplay={sendAmountStevemonDisplay}
              feeBreakdown={
                sendFeeBreakdown
                  ? {
                      netToRecipient: formatStevemonToTetDisplay(sendFeeBreakdown.netToRecipient),
                      feeTotal: formatStevemonToTetDisplay(sendFeeBreakdown.feeTotal),
                    }
                  : null
              }
              memo={sendMessage}
              onMemoChange={(v) => setSendMessage(v.slice(0, 64))}
              userMessage={sendTransferUserMsg}
              phase={sendTransferPhase}
              sending={sendingTx}
              signerReady={isSignerReady}
              buttonLabel={sendTransferButtonLabel}
              onSend={() => void onSendCoins()}
              contacts={addrBook}
            />
          ) : tab === "Receive Coins" ? (
            <InboxReceivePanel
              address={activeAccountAddress}
              addressCopied={inboxAddressCopied}
              onCopyAddress={() => {
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
              onClearInbox={() => clearInboxForRecipient(activeIdentityPubkeyNorm)}
              messages={inboxForIdentity}
            />
          ) : tab === "Messages" ? (
            <MessagesPanel
              key={founderWalletIdHex64}
              outset={outset}
              inset={inset}
              winBtn={winBtn}
              baseUrl={baseUrl}
              myWalletId={founderWalletIdHex64}
            />
          ) : tab === "Files" ? (
            <FilesPanel
              key={founderWalletIdHex64}
              baseUrl={baseUrl}
              myWalletId={founderWalletIdHex64}
              contacts={addrBook}
            />
          ) : tab === "Address Book" ? (
            <AddressBookPanel contacts={addrBook} onAdd={onAddAddress} />
          ) : tab === "AI Task Terminal" ? (
            <AITaskTerminalPanel
              chatScrollRef={aiChatScrollRef}
              bestNumber={bestNumber}
              statusWorkers={statusWorkers}
              messages={aiChatMessages}
              submitting={aiTaskSubmitting}
              onSubmit={() => void onSubmitAiTaskRequest()}
              prompt={aiTaskPrompt}
              onPromptChange={setAiTaskPrompt}
              signerReady={isSignerReady}
              sendDisabled={
                aiTaskSubmitting || !isSignerReady || aiEscrowEstimateStevemon <= 0n || aiTaskPrompt.trim().length === 0
              }
              promptBytes={stringToU8a(aiTaskPrompt).length}
              promptMaxBytes={AI_PROMPT_MAX_BYTES}
              lastTaskId={lastAiDemandTaskId}
            />
          ) : tab === "Explorer" ? (
            <ExplorerPanel
              baseUrl={baseUrl}
              query={explorerQuery}
              onQueryChange={setExplorerQuery}
              onSearch={(e) => void onExplorerSearch(e)}
              loading={explorerLoading}
              error={explorerErr}
              block={explorerBlock}
              tx={explorerTx}
              recentBlocks={latestBlocks}
              totalSupplyDisplay={totalSupplyStevemon != null ? formatStevemonToTetCompact(totalSupplyStevemon) : totalSupply}
              totalSupplyTitle={
                totalSupplyStevemon != null ? `${formatStevemonToTetFullDisplay(totalSupplyStevemon)} TET` : totalSupply
              }
              workerPoolDisplay={
                workerPoolBalanceStevemon !== null ? `${formatStevemonToTetCompact(workerPoolBalanceStevemon)} TET` : "—"
              }
              workerPoolTitle={
                workerPoolBalanceStevemon !== null
                  ? `${formatStevemonToTetFullDisplay(workerPoolBalanceStevemon)} TET`
                  : undefined
              }
            />
          ) : tab === "Worker" ? (
            <WorkerPanel
              caacLine={networkCaacLine}
              error={workerCockpitErr}
              walletLabel={normalizeWalletId64(founderWalletIdHex64)}
              updatedAt={workerCockpitUpdatedAt}
              loading={workerCockpitLoading}
              onStartMining={onStartMiningGpu}
              miningOn={miningOn}
              onMiningToggle={setMiningOn}
              cockpit={workerCockpit}
              log={miningLog}
            />
          ) : null}
          </div>
          </section>

          {/* Right pane: Ledger always */}
          <LedgerConsole
            ref={ledgerRef}
            signerLabel={activeIdentityLabel}
            text={ledger.join("\n")}
          />
        </div>

        {/* Status bar (Windows classic) */}
        <StatusBar
          badgeClass={syncUi.badgeClass}
          badgeText={syncUi.badgeText}
          baseUrl={baseUrl}
          connectionsDisplay={statusConnectionsDisplay}
          securityActive={statusSecurity.active}
          securityLabel={statusSecurity.label}
          workersDisplay={statusWorkersDisplay}
          networkComputeTflopsLabel={networkComputeTflopsLabel}
          epochDisplay={statusEpochDisplay}
          pqcStatusShort={pqcStatusShort}
          blockDisplay={statusBlockDisplay}
          shortLabel={syncUi.shortLabel}
        />
      </div>

      {walletUnlockOpen ? (
        // `hideClose` mirrors the legacy "Required" state: when the device already has a wallet
        // and it's locked, the unlock window is mandatory (no X, no backdrop dismiss). Title stays
        // dynamic to preserve the original create-vs-unlock wording.
        <Win95Window
          title={persistedWalletKind === "none" ? "Wallet — local signing (PQC)" : "Enter PIN to Unlock"}
          onClose={() => setWalletUnlockOpen(false)}
          hideClose={walletGate === "locked" && persistedWalletKind !== "none"}
          badge="Required"
          closeOnBackdrop={false}
          width="56rem"
          className="space-y-3 text-sm text-black"
        >
          <WalletUnlockBody
            persistedWalletKind={persistedWalletKind}
            walletUnlockErr={walletUnlockErr}
            walletBusy={walletBusy}
            newMnemonicDraft={newMnemonicDraft}
            newWalletPin={newWalletPin}
            setNewWalletPin={setNewWalletPin}
            importMnemonicInput={importMnemonicInput}
            setImportMnemonicInput={setImportMnemonicInput}
            importWalletPin={importWalletPin}
            setImportWalletPin={setImportWalletPin}
            walletSecretInput={walletSecretInput}
            setWalletSecretInput={setWalletSecretInput}
            onGenerateMnemonic={() =>
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
            onWalletCreateSave={() => void onWalletCreateSave()}
            onWalletImportSave={() => void onWalletImportSave()}
            onWalletUnlockSubmit={() => void onWalletUnlockSubmit()}
          />
        </Win95Window>
      ) : null}

      {aboutOpen ? (
        <Win95Window
          title="About TET v0.1"
          onClose={() => setAboutOpen(false)}
          width="48rem"
          closeOnBackdrop={false}
        >
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
        </Win95Window>
      ) : null}

      {manualOpen ? (
        <Win95Window
          title="TET Network - User Manual"
          onClose={() => setManualOpen(false)}
          width="48rem"
          closeOnBackdrop={false}
        >
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
        </Win95Window>
      ) : null}

      {backupOpen ? (
        <Win95Window
          title="Wallet Backup"
          onClose={() => setBackupOpen(false)}
          width="32rem"
          closeOnBackdrop={false}
          className="p-4"
        >
          <div className="flex gap-3 items-start">
            <div
              className="w-10 h-10 bg-[#DAD8D2] border-2 border-t-white border-l-white border-b-[#808080] border-r-[#808080] flex items-center justify-center"
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
        </Win95Window>
      ) : null}

      {changePinOpen ? (
        <Win95Window
          title="Change PIN"
          onClose={() => closeChangePin()}
          width="32rem"
          closeOnBackdrop={false}
          className="p-4"
        >
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
        </Win95Window>
      ) : null}

      {networkOpen ? (
        <Win95Window
          title="Network Configuration"
          onClose={() => setNetworkOpen(false)}
          width="36rem"
          closeOnBackdrop={false}
          className="p-4"
        >
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
        </Win95Window>
      ) : null}

      {whitepaperOpen ? (
        // Notepad.exe joke preserved via the "Whitepaper.txt - Notepad" window title; the inner
        // client area stays a pure-white monospace, word-wrap-only, vertically scrollable text box
        // with the classic Win9x scrollbar. (Frame chrome is now the shared Win95Window outset bevel.)
        <Win95Window
          title="Whitepaper.txt - Notepad"
          onClose={() => setWhitepaperOpen(false)}
          width="48rem"
          closeOnBackdrop={false}
          className="p-2"
        >
          <div
            className={[
              inset,
              "h-[min(78vh,680px)] min-w-0 max-w-full overflow-y-auto overflow-x-hidden px-[3px] py-[2px]",
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
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
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
        </Win95Window>
      ) : null}
    </main>
  );
}
