import type { Metadata } from "next";
import KeysView from "./KeysView";

export const metadata: Metadata = {
  title: "TET: your keys",
  description: "A site can check that your key answered its question, without learning your name.",
};

export default function Page() {
  return <KeysView />;
}
