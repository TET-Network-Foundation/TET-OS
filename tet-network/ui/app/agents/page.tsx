import type { Metadata } from "next";
import AgentsControl from "./AgentsControl";

export const metadata: Metadata = {
  title: "Agent and machine control · TET",
  description: "Check your machines' signed logs in this tab, see their one-time permissions, and get the command that gives a machine a new one. Prototype, local only.",
};

export default function Page() {
  return <AgentsControl />;
}
