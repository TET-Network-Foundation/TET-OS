import type { Metadata } from "next";
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
        <div className="relative z-0">{children}</div>
      </body>
    </html>
  );
}
