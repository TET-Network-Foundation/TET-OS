import type { Metadata } from "next";
import AboutView from "./AboutView";

export const metadata: Metadata = {
  title: "About TET",
  description: "Who builds TET, and how to reach the person who does.",
};

export default function Page() {
  return <AboutView />;
}
