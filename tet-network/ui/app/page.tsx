import { redirect } from "next/navigation";

/** The old home page is gone: the entrance is /try (the /os desktop's onboarding is /os/start). */
export default function Home() {
  redirect("/try");
}
