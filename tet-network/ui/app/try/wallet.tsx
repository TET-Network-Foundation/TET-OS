"use client";

/**
 * The tab's disposable wallet, shared by every panel. Made on the first action that needs it, so
 * posting, sending or answering is one tap; the page then shows a "save your words" bar. Messaging
 * keys are published only from the explicit banner in Mail and Files: publishing is public, so the
 * visitor chooses it. Nothing is stored: forget the tab and the wallet is gone unless the words were saved.
 *
 * Joining the anonymity set is its own step, never folded into a post: a join is public, and a post
 * sent automatically the moment the join takes effect would point straight back at it. So `joinAnon`
 * only joins; panels post anonymously only once `anon.member` is true, on a separate tap.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { generateDisposableWords } from "../lib/disposable_wallet.mjs";
import { activateTryWallet, forgetTryWallet } from "../lib/try_session";
import { getTmailKeySession } from "../lib/tmail_session";
import { buildTmailKeyRegistrationV1 } from "../lib/tmail_keys";
import { getTmailKeys, putTmailKeys } from "../lib/tet_core_http";
import { anonMembership, registerForAnon } from "../lib/try_board";
import { probeProver } from "../lib/board.mjs";
import { DEFAULT_PROVER_URL } from "../lib/anon_poster.mjs";

export const PROVER_URL = process.env.NEXT_PUBLIC_TET_PROVER_URL || DEFAULT_PROVER_URL;

export const BASE = "/tet-node-api";

/** A remembered ID is locked (forgotten in this tab) after this long without any input. */
export const AUTO_LOCK_MS = 15 * 60_000;

/**
 * Lock now? Only an ID this device remembers (it can be reopened with the device password), and
 * only after `AUTO_LOCK_MS` without input: locking an unsaved ID would lose it for good.
 */
export function shouldAutoLock(o: { lockable: boolean; idleMs: number }): boolean {
  return o.lockable && o.idleMs >= AUTO_LOCK_MS;
}

type Wallet = { words: string; walletId: string };

/** This tab's place in the anonymity set (null until checked). */
export type AnonState = { member: boolean; members: number; nextEpochAtMs: number; joined: boolean } | null;

type Ctx = {
  wallet: Wallet | null;
  anon: AnonState;
  /** Re-check membership (needs a wallet; does nothing without one). */
  refreshAnon: () => Promise<void>;
  /** Join the anonymity set (public). Makes the wallet first if needed. Never posts anything. */
  joinAnon: () => Promise<void>;
  /** The wallet id, making the wallet first if there is none. */
  ensureWallet: () => Promise<string>;
  /** Open the wallet from 12 words this device remembered (encrypted; see lib/device_store.ts). */
  openWithWords: (words: string) => Promise<string>;
  /** Publish this wallet's messaging keys once (needed to receive Tmail and files). */
  ensureMessagingKeys: () => Promise<void>;
  /** Whether this wallet's messaging keys are published ("unknown" until checked or with no wallet). */
  keys: "unknown" | "none" | "published";
  checkKeys: () => Promise<void>;
  /** Whether the native prover answers on this computer (checked once per tab). */
  prover: "unknown" | "found" | "missing";
  forget: () => void;
  /** The open ID is the one this device remembers (opened from it, or just remembered): it auto-locks. */
  noteRemembered: () => void;
};

const WalletCtx = createContext<Ctx | null>(null);

export function WalletProvider(props: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [keys, setKeys] = useState<"unknown" | "none" | "published">("unknown");
  // The one wallet of this tab. Kept in a ref so a callback from an earlier render never makes a
  // second one: every caller awaits the same promise until `forget`.
  const current = useRef<Promise<Wallet> | null>(null);
  const keysFor = useRef<string | null>(null);

  const ensureWallet = useCallback(async () => {
    current.current ??= (async () => {
      const words = generateDisposableWords();
      const w = { words, walletId: await activateTryWallet(words) };
      setWallet(w);
      return w;
    })().catch((e: unknown) => {
      current.current = null;
      throw e;
    });
    return (await current.current).walletId;
  }, []);

  /** Open the tab's wallet from existing words (a key remembered on this device). */
  const openWithWords = useCallback(async (words: string) => {
    current.current = (async () => {
      const w = { words, walletId: await activateTryWallet(words) };
      setWallet(w);
      return w;
    })().catch((e: unknown) => {
      current.current = null;
      throw e;
    });
    keysFor.current = null;
    setKeys("unknown");
    return (await current.current).walletId;
  }, []);

  const ensureMessagingKeys = useCallback(async () => {
    const id = await ensureWallet();
    if (keysFor.current === id) return;
    const have = await getTmailKeys(BASE, id);
    if (!have.registration) {
      const ks = getTmailKeySession();
      if (!ks) throw new Error("no wallet in this tab");
      const reg = await buildTmailKeyRegistrationV1({ x25519_pub: ks.x25519_pub, mlkem_pub: ks.mlkem_pub, baseUrl: BASE });
      const r = await putTmailKeys(BASE, id, reg);
      if (!r.ok) throw new Error(r.text || `could not publish your messaging keys (HTTP ${r.status})`);
    }
    keysFor.current = id;
    setKeys("published");
  }, [ensureWallet]);

  const [anon, setAnon] = useState<AnonState>(null);
  const [prover, setProver] = useState<"unknown" | "found" | "missing">("unknown");

  useEffect(() => {
    let live = true;
    void probeProver({ url: PROVER_URL }).then((p: "found" | "missing") => live && setProver(p));
    return () => {
      live = false;
    };
  }, []);

  const checkKeys = useCallback(async () => {
    if (!current.current) return;
    const id = (await current.current).walletId;
    const r = await getTmailKeys(BASE, id);
    // An inbox turned on with an older version of TET: re-sign it as v2 (pages now refuse older
    // registrations). Nothing new is published: the inbox was already public, with the same keys.
    if (r.ok && r.registration && r.registration.v !== 2) {
      const ks = getTmailKeySession();
      if (ks && ks.walletIdHex64 === id) {
        const reg = await buildTmailKeyRegistrationV1({ x25519_pub: ks.x25519_pub, mlkem_pub: ks.mlkem_pub, baseUrl: BASE });
        await putTmailKeys(BASE, id, reg).catch(() => null);
      }
    }
    if (r.ok) setKeys(r.registration ? "published" : "none");
  }, []);
  const joined = useRef(false);

  const refreshAnon = useCallback(async () => {
    if (!current.current) return;
    await current.current;
    const m = await anonMembership(BASE);
    if (m) setAnon({ ...m, joined: joined.current || m.member });
  }, []);

  const joinAnon = useCallback(async () => {
    await ensureWallet();
    await registerForAnon(BASE);
    joined.current = true;
    await refreshAnon();
  }, [ensureWallet, refreshAnon]);

  // While joined but not yet a member, re-check until the next epoch admits us.
  useEffect(() => {
    if (!anon || anon.member || !anon.joined) return;
    const wait = Math.min(10_000, Math.max(2_000, anon.nextEpochAtMs - Date.now() + 1_500));
    const t = setTimeout(() => void refreshAnon(), wait);
    return () => clearTimeout(t);
  }, [anon, refreshAnon]);

  const lockable = useRef(false);
  const noteRemembered = useCallback(() => {
    lockable.current = true;
  }, []);
  const forget = useCallback(() => {
    lockable.current = false;
    joined.current = false;
    setAnon(null);
    setKeys("unknown");
    forgetTryWallet();
    current.current = null;
    keysFor.current = null;
    setWallet(null);
  }, []);

  // Auto-lock (docs/THREAT_MODEL.md rule 7): a remembered ID is forgotten in this tab after
  // AUTO_LOCK_MS without input; it reopens with the device password.
  useEffect(() => {
    if (!wallet) return;
    let last = Date.now();
    const seen = () => {
      last = Date.now();
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, seen, { passive: true });
    const tick = setInterval(() => {
      if (shouldAutoLock({ lockable: lockable.current, idleMs: Date.now() - last })) forget();
    }, 30_000);
    return () => {
      clearInterval(tick);
      for (const e of events) window.removeEventListener(e, seen);
    };
  }, [wallet, forget]);

  const value = useMemo(
    () => ({ wallet, anon, refreshAnon, joinAnon, ensureWallet, openWithWords, ensureMessagingKeys, keys, checkKeys, prover, forget, noteRemembered }),
    [wallet, anon, refreshAnon, joinAnon, ensureWallet, openWithWords, ensureMessagingKeys, keys, checkKeys, prover, forget, noteRemembered],
  );
  return <WalletCtx.Provider value={value}>{props.children}</WalletCtx.Provider>;
}

export function useTryWallet(): Ctx {
  const c = useContext(WalletCtx);
  if (!c) throw new Error("useTryWallet outside WalletProvider");
  return c;
}
