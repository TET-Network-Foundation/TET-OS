import type { ReactNode } from "react";
import { LangProvider } from "../try/i18n";
import { SiteFrame } from "../site/kit";

/** The public site: the home page and its five sections share one frame and one language switch. */
export default function SiteLayout(props: { children: ReactNode }) {
  return (
    <LangProvider>
      <SiteFrame>{props.children}</SiteFrame>
    </LangProvider>
  );
}
