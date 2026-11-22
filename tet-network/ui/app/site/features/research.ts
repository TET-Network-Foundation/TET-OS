/** The research section: its card on the home page, and every feature it names (with a status). */
import type { Feature, Section } from "../types";

export const SECTION: Section = {
  href: "/research",
  title: "Research",
  sentence: "Ideas we are studying. None of them is built; the two small models on this page run in your browser.",
};

export const FEATURES: Feature[] = [
  {
    id: "one-shot-tet",
    title: "Keys that sign once",
    summary:
      "A research note on one-shot signatures: a quantum key that can sign one message and is then used up. Today every \"once\" in TET is caught afterwards by whoever keeps the record; a one-shot key is meant to make a second signature impossible, but only if its setup can be trusted.",
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
    title: "A sample set of one-time keys",
    summary:
      "A concept page where you can hand over messages signed by a sample key set whose keys each work once. It is a model on an ordinary computer, not a key.",
    status: "idea",
    evidence: [{ pr: 182, what: "the /future concept page" }],
    shows: [
      "What the idea would change: a used sample key refuses a second hand-over.",
      "What it would not change, in the page's own Shows and Does not show.",
    ],
    doesNot: [
      "A real one-shot key. A copy of this model could be used twice.",
      "Anything real: no request leaves the page, and nothing is stored.",
    ],
    link: { href: "/future", label: "Open the sample key set" },
  },
  {
    id: "learning-model",
    title: "A learning model",
    summary:
      "A small model with a few simulated qubits, on this page: signing uses the key up, and a \"copy the key\" button works only because it is a simulation. It shows why a real one-shot key could not be copied.",
    status: "idea",
    evidence: [{ path: "tet-network/ui/app/site/run/one_shot_model.ts" }, { path: "docs/research/ONE_SHOT_TET.md" }],
    shows: ["What the model is meant to teach: a simulation can be copied, so its key can sign twice; a real one-shot key cannot be copied."],
    doesNot: [
      "A one-shot signature scheme. The model's checker is told how the key was made; a real scheme could not work that way.",
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
  {
    id: "permit-language",
    title: "Permits written as sentences",
    summary:
      "A sketch of a small language for permits: one line, such as allow agent \"shopper\" to \"buy\" once, before block N, becomes one one-time permit. A parser on this page turns each line into a permit and runs the permit check on it.",
    status: "idea",
    evidence: [{ path: "docs/research/PERMIT_LANGUAGE.md" }, { path: "tet-network/ui/app/site/run/permit_lang.ts" }],
    shows: ["That each line can be turned into the one-time permit TET's machine notebook already has, and checked by the same code."],
    doesNot: [
      "A designed language: the sketch has one sentence form and nothing else.",
      "That TET will have a permission language. Nothing is decided.",
      "How it compares with Cedar or OPA in practice: the note compares them on paper.",
    ],
  },
];
