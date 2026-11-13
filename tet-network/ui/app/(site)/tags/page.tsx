import type { Metadata } from "next";
import TagsView from "./TagsView";

export const metadata: Metadata = {
  title: "TET: genuine tags for small makers",
  description: "A maker puts a chip tag on what they make, and a buyer's tap shows whether that chip knows the maker's key.",
};

export default function Page() {
  return <TagsView />;
}
