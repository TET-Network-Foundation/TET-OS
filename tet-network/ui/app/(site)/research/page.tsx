import type { Metadata } from "next";
import ResearchView from "./ResearchView";

export const metadata: Metadata = {
  title: "TET research: ideas being studied",
  description: "Ideas TET is studying, each with what it would change and what it would not. Nothing on this page runs.",
};

export default function Page() {
  return <ResearchView />;
}
