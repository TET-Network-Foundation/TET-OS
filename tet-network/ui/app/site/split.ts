/**
 * The site in two halves (owner, 2026-11-13):
 * - the project site explains TET and is served at PROJECT_URL (tetnet.org): the home page, the five
 *   sections, /about and /changelog;
 * - the app is what you try, served at APP_URL (app.tetnet.org): /try, /agents, /signin, /future,
 *   /market.
 *
 * One codebase, two builds. The role is chosen at build time with TET_SITE_ROLE:
 *   project  app routes redirect to APP_URL (same path and query);
 *   app      project routes redirect to PROJECT_URL, and "/" goes to /try;
 *   all      (default) everything is served: local development and the local demo.
 * Routes in neither list (/whitepaper, /verify, the older pages) are served by both, as today.
 * The redirects are in next.config.ts; every "Try it" link on the project site goes through
 * appHref(), and scripts/site_guard.mjs refuses a raw app path in a project page.
 * Nothing is served anywhere yet.
 */
export const PROJECT_ROUTES = ["/", "/tags", "/machines", "/keys", "/services", "/research", "/about", "/changelog"] as const;
export const APP_ROUTES = ["/try", "/agents", "/signin", "/future", "/market"] as const;

const trim = (u: string) => u.replace(/\/+$/, "");
/** Where the app is served. Override with NEXT_PUBLIC_TET_APP_URL (e.g. http://127.0.0.1:3100 locally). */
export const APP_URL = trim(process.env.NEXT_PUBLIC_TET_APP_URL || "https://app.tetnet.org");
/** Where the project site is served. Override with NEXT_PUBLIC_TET_PROJECT_URL. */
export const PROJECT_URL = trim(process.env.NEXT_PUBLIC_TET_PROJECT_URL || "https://tetnet.org");

export function isAppPath(href: string): boolean {
  return APP_ROUTES.some((r) => href === r || href.startsWith(`${r}?`) || href.startsWith(`${r}/`) || href.startsWith(`${r}#`));
}

/** A link from the project site: app paths go to APP_URL, everything else is left alone. */
export function appHref(href: string): string {
  return isAppPath(href) ? `${APP_URL}${href}` : href;
}
