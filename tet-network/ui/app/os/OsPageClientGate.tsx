"use client";

import dynamic from "next/dynamic";

const SovereignOS = dynamic(() => import("./OsClient"), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen bg-[#D6D4CE] p-4 font-mono text-sm text-black">
      Loading Sovereign OS...
    </main>
  ),
});

export default function OsPageClientGate() {
  return <SovereignOS />;
}
