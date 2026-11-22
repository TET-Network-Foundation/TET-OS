import type { Metadata } from "next";
import Services from "./Services";

export const metadata: Metadata = {
  title: "TET: everyday services",
  description: "Bookings, deliveries and reviews that would rest on signed records instead of trust in one platform.",
};

export default function Page() {
  return <Services />;
}
