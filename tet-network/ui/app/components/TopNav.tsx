"use client";

import Link from "next/link";
import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { useLanguage } from "../context/LanguageContext";
import { useT } from "../i18n/useT";

/* eslint-disable @next/next/no-img-element */

function LanguageSelectorButton(props: { lang: "en" | "jp"; toggleLang: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={props.toggleLang}
      className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
      aria-label={props.label}
      title={props.label}
    >
      <span>{props.lang === "en" ? "EN" : "JP"}</span>
    </button>
  );
}

function CreateWalletButton(props: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
    >
      {props.label}
    </button>
  );
}

export default function TopNav() {
  const pathname = usePathname();
  const { lang, toggleLang } = useLanguage();
  const { t } = useT();
  const onCreateNewWallet = useCallback(() => {
    window.location.assign("/setup");
  }, []);
  const hide = pathname === "/os" || pathname?.startsWith("/os/") || pathname === "/setup" || pathname?.startsWith("/setup/");
  if (hide) return null;

  return (
    <nav className="w-full flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white text-black">
      <div className="flex items-center">
        <Link href="/" className="inline-flex items-center">
          <img src="/logo.jpg" alt="TET Logo" className="w-auto h-12 object-contain" />
        </Link>
      </div>
      
      <div className="flex items-center gap-x-6">
        <Link href="/" className="text-sm font-medium hover:text-gray-600">Home</Link>
        <Link href="/participate" className="text-sm font-medium hover:text-gray-600">For Builders</Link>
        <Link href="/whitepaper" className="text-sm font-medium hover:text-gray-600">Whitepaper</Link>
        <Link href="/create-wallet" className="text-sm font-medium hover:text-gray-600">Create Wallet</Link>
        <Link href="/os" className="text-sm font-bold text-fuchsia-600 hover:text-fuchsia-800">Launch TET-OS</Link>
      </div>
      
      <div className="flex items-center gap-x-4">
        <LanguageSelectorButton lang={lang} toggleLang={toggleLang} label={t("nav.language")} />
        <CreateWalletButton onClick={onCreateNewWallet} label={t("nav.createWallet")} />
      </div>
    </nav>
  );
}

