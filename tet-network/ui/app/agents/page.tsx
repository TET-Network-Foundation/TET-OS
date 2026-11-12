import type { Metadata } from "next";
import AgentsControl from "./AgentsControl";

export const metadata: Metadata = {
  title: "Agent and machine control · TET",
  description: "Check your devices' machine notebooks in this tab, and get the command that gives a device a one-time permit. Prototype, local only.",
};

export default function Page() {
  return <AgentsControl />;
}
