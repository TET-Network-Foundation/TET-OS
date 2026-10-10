"use client";

/**
 * The home view's one small "continue" line: the last public board, and behind "key options" the
 * opt-in "remember my key on this device" (passphrase-encrypted, lib/device_store.ts), opening a
 * remembered key, and "forget this device".
 */
import { useEffect, useState } from "react";
import { forgetDevice, getUi, hasRememberedKey, openRememberedKey, rememberKey, setUi } from "../lib/device_store";
import { Button, FOCUS, Input, cx } from "./ui";
import { useTryWallet } from "./wallet";
import { useLang } from "./i18n";

const LINK = cx(FOCUS, "rounded-sm underline underline-offset-2");

/**
 * The three fixed sentences (docs/THREAT_MODEL.md rule 8), shown wherever the 12 words are entered,
 * saved or remembered. Guarded by scripts/try_safety_lines_guard.mjs.
 */
export function SafetyLines() {
  const { t } = useLang();
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-[13.5px] text-[#5d646d]">
      <li>{t("TET asks for your passphrase (12 words) only on the restore screen; support never DMs you.")}</li>
      <li>{t("On a device managed by your school or employer, the admin can see everything.")}</li>
      <li>{t("Lose your passphrase (12 words) and nobody can recover it.")}</li>
    </ul>
  );
}

export default function ContinueBlock(props: { lastBoard: { name: string; invite: string | null } | null; onOpenBoard: (invite: string) => void }) {
  const { t } = useLang();
  const { wallet, openWithWords } = useTryWallet();
  const [returning, setReturning] = useState(false);
  const [remembered, setRemembered] = useState(false);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showRemember, setShowRemember] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreWords, setRestoreWords] = useState("");

  useEffect(() => {
    // Read once after mount: storage may be missing, and the server render must match the first one.
    const t0 = setTimeout(() => {
      setReturning(getUi("tet.ui.v1.visited") === "1");
      setRemembered(hasRememberedKey());
      setUi("tet.ui.v1.visited", "1");
    }, 0);
    return () => clearTimeout(t0);
  }, []);

  const open = async () => {
    setMsg("");
    setBusy(true);
    try {
      await openWithWords(await openRememberedKey(pass));
      setPass("");
      setMsg(t("Your ID is open in this tab."));
    } catch (e: unknown) {
      setMsg(e instanceof Error && e.message === "Wrong passphrase." ? t("Wrong device password. Try again, or open with your passphrase (12 words).") : t("This device can't open your remembered ID. Open it with your passphrase (12 words) instead."));
    } finally {
      setBusy(false);
    }
  };
  // The restore screen: the only place the page asks for the 12 words.
  const restore = async () => {
    setMsg("");
    setBusy(true);
    try {
      await openWithWords(restoreWords.trim());
      setRestoreWords("");
      setRestoreOpen(false);
      setMsg(t("Your ID is open in this tab."));
    } catch {
      setMsg(t("Those aren't 12 valid words. Check them and try again."));
    } finally {
      setBusy(false);
    }
  };
  const remember = async () => {
    setMsg("");
    if (pass !== pass2) return setMsg(t("The two device passwords differ. Type them again."));
    if (!wallet) return;
    setBusy(true);
    try {
      await rememberKey(wallet.words, pass);
      setPass("");
      setPass2("");
      setRemembered(true);
      setShowRemember(false);
      setMsg(t("Remembered on this device, encrypted with your device password."));
    } catch (e: unknown) {
      setMsg(e instanceof Error && /at least 8/.test(e.message) ? t("Use a device password of at least 8 characters.") : t("This browser won't let the page remember anything."));
    } finally {
      setBusy(false);
    }
  };

  const keyOptions = !wallet || (wallet && !remembered) || remembered || returning;
  if (!props.lastBoard && !keyOptions) return null;
  return (
    <div className="text-[13.5px] text-[#5d646d]">
      <p>
        {props.lastBoard ? (
          <>
            {t("continue:")}{" "}
            {props.lastBoard.invite ? (
              <button type="button" className={LINK} onClick={() => props.onOpenBoard(props.lastBoard!.invite!)}>
                {props.lastBoard.name}
              </button>
            ) : (
              <span>
                {props.lastBoard.name} {t("(invite-only: open it with its invite link)")}
              </span>
            )}
          </>
        ) : null}
        {keyOptions ? (
          <>
            {props.lastBoard ? " · " : ""}
            <button type="button" aria-expanded={keysOpen} className={LINK} onClick={() => setKeysOpen(!keysOpen)}>
              {!wallet && remembered ? t("open your remembered ID") : t("ID options")}
            </button>
          </>
        ) : null}
      </p>
      {keysOpen ? (
        <ul className="mt-2 space-y-1 text-left text-[15px] text-[#1c1f23]">
            {!wallet && remembered ? (
              <li className="space-y-1.5 pt-1">
                <p>{t("An ID is remembered on this device. Open it with your device password:")}</p>
                <div className="flex max-w-sm gap-2">
                  <Input ariaLabel={t("Device password")} type="password" value={pass} onChange={setPass} placeholder={t("Device password")} />
                  <Button disabled={busy || !pass} onClick={() => void open()}>
                    {t("Open")}
                  </Button>
                </div>
              </li>
            ) : null}
            {wallet && !remembered ? (
              <li className="pt-1">
                {showRemember ? (
                  <div className="max-w-sm space-y-1.5">
                    <p className="text-[14px] text-[#5d646d]">{t("Anyone with this device and your device password can use your ID. A script injected into this page could read it while it's open.")}</p>
                    <SafetyLines />
                    <Input ariaLabel={t("Device password")} type="password" value={pass} onChange={setPass} placeholder={t("Device password (8 characters or more)")} />
                    <Input ariaLabel={t("Device password again")} type="password" value={pass2} onChange={setPass2} placeholder={t("Device password again")} />
                    <Button disabled={busy || !pass} onClick={() => void remember()}>
                      {t("Remember my ID on this device")}
                    </Button>
                  </div>
                ) : (
                  <button type="button" className={LINK} onClick={() => setShowRemember(true)}>
                    {t("Remember my ID on this device (optional, encrypted)")}
                  </button>
                )}
              </li>
            ) : null}
            {!wallet ? (
              <li className="pt-1">
                {restoreOpen ? (
                  <div className="max-w-md space-y-1.5">
                    <p className="text-[14px]">{t("Open an ID with your passphrase (12 words):")}</p>
                    <SafetyLines />
                    <textarea
                      value={restoreWords}
                      onChange={(e) => setRestoreWords(e.target.value)}
                      rows={2}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={t("Your passphrase (12 words)")}
                      className={cx(FOCUS, "w-full rounded-md border border-[#c9ced4] p-2 text-[15px]")}
                    />
                    <Button disabled={busy || restoreWords.trim().split(/\s+/).length !== 12} onClick={() => void restore()}>
                      {t("Open")}
                    </Button>
                  </div>
                ) : (
                  <button type="button" className={LINK} onClick={() => setRestoreOpen(true)}>
                    {t("Open an ID with your passphrase (12 words)")}
                  </button>
                )}
              </li>
            ) : null}
            {remembered || returning ? (
              <li>
                <button
                  type="button"
                  className={cx(LINK, "text-[14px] text-[#5d646d]")}
                  onClick={() => {
                    forgetDevice();
                    setRemembered(false);
                    setReturning(false);
                    setMsg(t("This device forgot everything the page kept."));
                  }}
                >
                  {t("Forget this device")}
                </button>
              </li>
            ) : null}
        </ul>
      ) : null}
      {msg ? <p className="mt-1">{msg}</p> : null}
    </div>
  );
}
