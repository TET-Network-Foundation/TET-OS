import type { Metadata } from "next";
import { LanguageProvider } from "./context/LanguageContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "TET Network",
  description: "TET Network public portal and TET OS.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-[#D4D0C8] text-black font-sans">
        <LanguageProvider>
          <div className="relative z-0">{children}</div>
        </LanguageProvider>
      </body>
    </html>
  );
}
