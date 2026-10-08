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
      setMsg(t("Your key is open in this tab."));
    } catch (e: unknown) {
      setMsg(e instanceof Error && e.message === "Wrong passphrase." ? t("Wrong passphrase. Try again, or open with your 12 words.") : t("This device can't open the remembered key. Open with your 12 words instead."));
    } finally {
      setBusy(false);
    }
  };
  const remember = async () => {
    setMsg("");
    if (pass !== pass2) return setMsg(t("The two passphrases differ. Type them again."));
    if (!wallet) return;
    setBusy(true);
    try {
      await rememberKey(wallet.words, pass);
      setPass("");
      setPass2("");
      setRemembered(true);
      setShowRemember(false);
      setMsg(t("Remembered on this device, encrypted with your passphrase."));
    } catch (e: unknown) {
      setMsg(e instanceof Error && /at least 8/.test(e.message) ? t("Use a passphrase of at least 8 characters.") : t("This browser won't let the page remember anything."));
    } finally {
      setBusy(false);
    }
  };

  const keyOptions = (!wallet && remembered) || (wallet && !remembered) || remembered || returning;
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
              {!wallet && remembered ? t("open your remembered key") : t("key options")}
            </button>
          </>
        ) : null}
      </p>
      {keysOpen ? (
        <ul className="mt-2 space-y-1 text-left text-[15px] text-[#1c1f23]">
            {!wallet && remembered ? (
              <li className="space-y-1.5 pt-1">
                <p>{t("A key is remembered on this device. Open it with your passphrase:")}</p>
                <div className="flex max-w-sm gap-2">
                  <Input ariaLabel={t("Passphrase")} type="password" value={pass} onChange={setPass} placeholder={t("Passphrase")} />
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
                    <p className="text-[14px] text-[#5d646d]">{t("Anyone with this device and your passphrase can use your key. A script injected into this page could read it while it's open.")}</p>
                    <Input ariaLabel={t("Passphrase")} type="password" value={pass} onChange={setPass} placeholder={t("Passphrase (8 characters or more)")} />
                    <Input ariaLabel={t("Passphrase again")} type="password" value={pass2} onChange={setPass2} placeholder={t("Passphrase again")} />
                    <Button disabled={busy || !pass} onClick={() => void remember()}>
                      {t("Remember my key on this device")}
                    </Button>
                  </div>
                ) : (
                  <button type="button" className={LINK} onClick={() => setShowRemember(true)}>
                    {t("Remember my key on this device (optional, encrypted)")}
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
