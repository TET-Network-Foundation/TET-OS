/** The research section: its card on the home page, and every feature it names (with a status). */
import type { Feature, Section } from "../types";

export const SECTION: Section = {
  href: "/research",
  title: "Research",
  sentence: "Ideas we are studying. Nothing on this page runs.",
};

export const FEATURES: Feature[] = [
  {
    id: "one-shot-tet",
    title: "Keys that sign once",
    summary:
      "A research note on one-shot signatures: a quantum key that can sign one message and is then used up. Today every \"once\" in TET is caught afterwards by whoever keeps the record; a one-shot key would make the second signature impossible to make.",
    status: "idea",
    evidence: [{ path: "docs/research/ONE_SHOT_TET.md" }, { branch: "docs/one-shot-research", what: "the setup finding" }],
    shows: [
      "Where TET already limits a permission to one use, and who catches a second use today.",
      "What the papers that were read prove, and under which assumptions.",
      "That in the standard model the scheme read in most detail needs a trusted setup.",
    ],
    doesNot: [
      "That one-shot keys can be built or used today. Nothing quantum runs in TET.",
      "That TET will adopt them. Nothing here is proposed or planned.",
      "The proofs in the papers. Those were not read line by line.",
    ],
  },
  {
    id: "future-concept",
    title: "A sample wallet of one-time keys",
    summary:
      "A concept page where you can hand over notes from a sample wallet whose keys each work once. It is a model on an ordinary computer, not a key.",
    status: "idea",
    evidence: [{ pr: 182, what: "the /future concept page" }],
    shows: [
      "What the idea would change: a used key refuses a second hand-over.",
      "What it would not change, in the page's own Shows and Does not show.",
    ],
    doesNot: [
      "A real one-shot key. A copy of this model could be used twice.",
      "Anything real: no request leaves the page, and nothing is stored.",
    ],
    link: { href: "/future", label: "Open the sample wallet" },
  },
  {
    id: "learning-model",
    title: "A learning model",
    summary:
      "An idea for a small model with a few simulated qubits: it would show why a copied simulation can sign twice, and why a real one-shot key could not.",
    status: "idea",
    evidence: [],
    shows: ["What the model is meant to teach: a simulation can be copied, so its key can sign twice; a real one-shot key cannot be copied."],
    doesNot: [
      "A working model. Nothing is designed or built yet.",
      "Anything about real quantum hardware. A few simulated qubits on an ordinary computer are a model, not a key.",
    ],
  },
  {
    id: "fn-dsa",
    title: "FN-DSA, a second post-quantum signature",
    summary:
      "Today every TET signature is two signatures: Ed25519 and ML-DSA-44. FN-DSA is a second post-quantum signature scheme TET could add. Waiting for the FIPS 206 standard.",
    status: "idea",
    evidence: [],
    shows: ["What TET signs with today: each signature is an Ed25519 signature and an ML-DSA-44 signature together."],
    doesNot: [
      "Any FN-DSA code. Nothing is built, and nothing is decided.",
      "When the standard will be final. It has no date here.",
    ],
    link: { href: "https://groups.google.com/a/list.nist.gov/g/pqc-forum/c/CsWPP35LJWw", label: "Source: the pqc-forum discussion of the FIPS 206 plan" },
  },
];
