import type { Metadata } from "next";
import Home from "../site/Home";

export const metadata: Metadata = {
  title: "TET: keys for machines and agents",
  description: "Keys for machines and agents: what each key may do, and how many times.",
};

export default function Page() {
  return <Home />;
}
