"use client";

/**
 * The tab's disposable wallet, shared by every panel. Made on the first action that needs it, so
 * posting, sending or answering is one tap; the page then shows a "save your words" bar. Messaging
 * keys are registered on first use for the same reason. Registering is public, which the notices
 * say. Nothing is stored: forget the tab and the wallet is gone unless the words were saved.
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

export const BASE = "/tet-node-api";

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
  /** Publish this wallet's messaging keys once (needed to receive Tmail and files). */
  ensureMessagingKeys: () => Promise<void>;
  forget: () => void;
};

const WalletCtx = createContext<Ctx | null>(null);

export function WalletProvider(props: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
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
  }, [ensureWallet]);

  const [anon, setAnon] = useState<AnonState>(null);
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

  const forget = useCallback(() => {
    joined.current = false;
    setAnon(null);
    forgetTryWallet();
    current.current = null;
    keysFor.current = null;
    setWallet(null);
  }, []);

  const value = useMemo(
    () => ({ wallet, anon, refreshAnon, joinAnon, ensureWallet, ensureMessagingKeys, forget }),
    [wallet, anon, refreshAnon, joinAnon, ensureWallet, ensureMessagingKeys, forget],
  );
  return <WalletCtx.Provider value={value}>{props.children}</WalletCtx.Provider>;
}

export function useTryWallet(): Ctx {
  const c = useContext(WalletCtx);
  if (!c) throw new Error("useTryWallet outside WalletProvider");
  return c;
}
