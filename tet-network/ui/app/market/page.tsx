import type { Metadata } from "next";
import Market from "./Market";

export const metadata: Metadata = {
  title: "Market · TET",
  description: "Deliveries, bookings and listings with signed records. Prototype, local only: sample keys made in the tab, nothing sent, nothing here moves value.",
};

export default function Page() {
  return <Market />;
}
