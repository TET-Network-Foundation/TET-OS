import type { Metadata } from "next";
import ChangelogView from "./ChangelogView";

export const metadata: Metadata = {
  title: "TET changelog",
  description: "What changed, latest at the top, from the merged pull requests.",
};

export default function Page() {
  return <ChangelogView />;
}
