/**
 * /signin, "Sign in with TET": the fixed text and the recorded walkthrough. No JSX and no browser
 * APIs, so `scripts/signin_demo_guard.mjs` imports this module as the page does.
 *
 * The prototype is `tools/sign-in/signin.py` (design: docs/plans/SIGN_IN_WITH_TET.md, not reviewed).
 * Everything under "recorded" was captured on 2026-11-12 from a real run on 127.0.0.1:
 *   python3 tools/sign-in/signin.py serve --domain example.test --port 8765
 * with a throwaway key from `tet-cli keys generate --words 12` (its words were never written down),
 * signed with the `tet-cli agent sign` command in DEVICE_COMMAND and posted with curl. The server's
 * answers are copied byte for byte.
 */

/** Shown at the very top, in English and Japanese. */
export const STATUS_LINE = "Status: prototype, design not reviewed, not for real logins.";
/** The label on the walkthrough, in English and Japanese. */
export const WALKTHROUGH_LABEL = "Walkthrough: no server, nothing is signed or sent";
/** The design's limit sentence (docs/plans/SIGN_IN_WITH_TET.md), on every sign-in screen. */
export const LIMIT_LINE = "If you lose your passphrase (12 words), nobody can recover your account.";

/** tools/sign-in/README.md, "What it shows", word for word (the guard compares them). */
export const SHOWS = ["This key answered this challenge for this domain, once, before it expired."];
/** tools/sign-in/README.md, "What it does not show", word for word (the guard compares them). */
export const DOES_NOT_SHOW = [
  "Who holds the key. Anyone with the 12 words can answer. The server learns a key id, not a person.",
  "That the user meant to sign in to this domain: the client signs whatever challenge it is given. The design's signer would refuse a challenge whose origin is not the page that sent the user, and show the site's name before signing; neither is here.",
  "Anything across a restart: issued and used nonces live in memory.",
];

/** Live mode talks to this host only: the prototype binds to the loopback address. */
export const SIGNIN_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8765;

/** A port the visitor typed, or null. */
export function asPort(s: string): number | null {
  if (!/^\d{1,5}$/.test(s.trim())) return null;
  const n = Number(s.trim());
  return n >= 1 && n <= 65535 ? n : null;
}

/** The one URL live mode asks: the prototype's challenge, on 127.0.0.1. */
export function challengeUrl(port: number): string {
  if (asPort(String(port)) === null) throw new Error("not a port");
  return `http://${SIGNIN_HOST}:${port}/challenge`;
}

// ── recorded ──────────────────────────────────────────────────────────────────────────────────────

export const PAYLOAD_TYPE = "application/vnd.tet.signin-challenge+json";
/** signin.py's EXAMPLE_CHAIN: a chain id no node runs, and SHA-256("tet sign-in prototype"). */
export const EXAMPLE_CHAIN_ID = "tet-example-sign-in";
export const EXAMPLE_GENESIS_HASH = "7d40c12a75aa7f38118e61a966addeda308b35ec2299f4ab467849baec6afd63";
/** The throwaway key's Ed25519 key id, as the server answered it. */
export const KEY_ID = "tet-ed25519:6848297c2ac06548c64794d57aadc76863d9690f7a79fc7c3e44d841a27be57b";

export type Challenge = { v: 1; kind: "tet_signin_challenge_v1"; domain: string; nonce: string; expires_seq: number };
export type Scenario = {
  id: "accepted" | "replay" | "domain" | "expired";
  /** What the visitor's device did, in one line (English; translated on the page). */
  what: string;
  /** GET /challenge, exactly as the server sent it. */
  served: string;
  /** The challenge the device signed (its canonical bytes are what tet-cli signs). */
  signed: Challenge;
  /** POST /signin: the HTTP status and the body, exactly as the server sent them. */
  status: number;
  answer: string;
};

const N1 = "740b41bd772d44961e2f03fd75d912b5074c9e35ad2a39cc15621ef10c0cab34";
const N2 = "e2707610f99919596ba91a7253b9f6b3227692a704da423e9baf940a348dcc08";
const N3 = "bde8adca9aa14d79e6b9d634b3b6b308d263d05e4ec6821a1c92299d4dae19b2";
const KIND = "tet_signin_challenge_v1" as const;

export const SCENARIOS: Scenario[] = [
  {
    id: "accepted",
    what: "The device signs the challenge it was given and posts it once.",
    served: `{"v": 1, "kind": "tet_signin_challenge_v1", "domain": "example.test", "nonce": "${N1}", "expires_seq": 9}`,
    signed: { v: 1, kind: KIND, domain: "example.test", nonce: N1, expires_seq: 9 },
    status: 200,
    answer: `{"accepted": true, "key": "${KEY_ID}"}`,
  },
  {
    id: "replay",
    what: "The same signed answer is posted a second time.",
    served: `{"v": 1, "kind": "tet_signin_challenge_v1", "domain": "example.test", "nonce": "${N1}", "expires_seq": 9}`,
    signed: { v: 1, kind: KIND, domain: "example.test", nonce: N1, expires_seq: 9 },
    status: 403,
    answer: `{"refused": "nonce: already used"}`,
  },
  {
    id: "domain",
    what: "The challenge's domain is rewritten to evil.test, then validly signed.",
    served: `{"v": 1, "kind": "tet_signin_challenge_v1", "domain": "example.test", "nonce": "${N2}", "expires_seq": 10}`,
    signed: { v: 1, kind: KIND, domain: "evil.test", nonce: N2, expires_seq: 10 },
    status: 403,
    answer: `{"refused": "domain: the challenge is for 'evil.test', this is 'example.test'"}`,
  },
  {
    id: "expired",
    what: "The answer arrives after nine more challenges were issued.",
    served: `{"v": 1, "kind": "tet_signin_challenge_v1", "domain": "example.test", "nonce": "${N3}", "expires_seq": 11}`,
    signed: { v: 1, kind: KIND, domain: "example.test", nonce: N3, expires_seq: 11 },
    status: 403,
    answer: `{"refused": "expired: seq is 12, the challenge was good to 11"}`,
  },
];

/** signin.py's `canonical()`: sorted keys, no spaces, ASCII. These are the bytes the device signs. */
export function canonical(c: Challenge): string {
  return JSON.stringify({ domain: c.domain, expires_seq: c.expires_seq, kind: c.kind, nonce: c.nonce, v: c.v });
}

/** The commands the device runs (tet-cli's real flags; the chain variables are signin.py's). */
export function deviceCommand(c: Challenge, port = DEFAULT_PORT): string {
  return [
    `curl -s http://${SIGNIN_HOST}:${port}/challenge`,
    `printf '%s' '${canonical(c)}' > challenge.json`,
    `TET_CHAIN_ID=${EXAMPLE_CHAIN_ID} \\`,
    `TET_GENESIS_HASH=${EXAMPLE_GENESIS_HASH} \\`,
    `TET_MNEMONIC='…12 words…' \\`,
    `tet-cli agent sign --in challenge.json --payload-type ${PAYLOAD_TYPE}`,
    `curl -s -X POST --data-binary @challenge.json.sig.json http://${SIGNIN_HOST}:${port}/signin`,
  ].join("\n");
}

// ── what a site sees ──────────────────────────────────────────────────────────────────────────────

/** The only fields the left column shows: a key id, a challenge and a verdict. Never a name. */
export const SITE_SEES_FIELDS = ["keyId", "domain", "nonce", "expiresSeq", "verdict"] as const;
export type SiteSees = { keyId: string; domain: string; nonce: string; expiresSeq: number; verdict: string };

/** What the site holds after this scenario: this key answered this challenge, and its verdict. */
export function siteSees(s: Scenario): SiteSees {
  const a = JSON.parse(s.answer) as { accepted?: boolean; refused?: string };
  const verdict = a.accepted === true ? "accepted" : `refused: ${String(a.refused ?? "")}`;
  return { keyId: KEY_ID, domain: s.signed.domain, nonce: s.signed.nonce, expiresSeq: s.signed.expires_seq, verdict };
}
