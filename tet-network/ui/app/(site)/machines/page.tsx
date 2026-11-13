import type { Metadata } from "next";
import MachinesView from "./MachinesView";

export const metadata: Metadata = {
  title: "Machines and agents · TET",
  description: "A machine or an agent holds its own key, signs what it does, and may use a one-time permission only once.",
};

export default function Page() {
  return <MachinesView />;
}
