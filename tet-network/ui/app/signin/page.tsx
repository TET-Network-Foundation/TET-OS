/**
 * /signin, "Sign in with TET": the local prototype (tools/sign-in/signin.py) shown as a walkthrough,
 * with a live check that talks only to 127.0.0.1. Prototype; the design is not reviewed. Guarded by
 * scripts/signin_demo_guard.mjs. The page follows the visitor's language as /try does.
 */
import type { Metadata } from "next";
import { LangProvider } from "../try/i18n";
import { SignInView } from "./SignInView";

export const metadata: Metadata = {
  title: "Sign in with TET (prototype) · TET",
  description: "A walkthrough of the local Sign in with TET prototype: what a site sees, and what it does not show.",
};

export default function SignInPage() {
  return (
    <LangProvider>
      <SignInView />
    </LangProvider>
  );
}
