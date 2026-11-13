/** The keys section: its card on the home page, and every feature it names (with a status). */
import type { Feature, Section } from "../types";

export const SECTION: Section = {
  href: "/keys",
  title: "Your keys",
  sentence: "A site can check that your key answered its question, without learning your name.",
};

export const FEATURES: Feature[] = [
  {
    id: "sign-in-with-tet",
    title: "Sign in with TET",
    summary:
      "A site asks a one-time question, your key answers, and the site checks the answer. Design not reviewed. The prototype runs only on your own computer and is not for real logins.",
    status: "prototype",
    evidence: [
      { path: "tools/sign-in/signin.py" },
      { path: "tools/sign-in/README.md" },
      { path: "tools/sign-in/test_signin.py" },
      { path: "docs/plans/SIGN_IN_WITH_TET.md" },
      { pr: 181, what: "the /signin walkthrough page" },
    ],
    // tools/sign-in/README.md, in the everyday words of branch tools/signin-plain-words.
    shows: [
      "This key answered this site's question, once, before it expired.",
      "Both halves of the answer's signature were checked, Ed25519 and ML-DSA-44, by TET's existing verifier.",
    ],
    doesNot: [
      "Who holds the key. Anyone with the 12 words can answer. The site learns a key, not a person.",
      "That you meant to sign in to this site: the prototype signs any question it is given. The full design would check where the question came from and show you the site's name before signing; neither is built.",
      "Anything after a restart: the server keeps its questions in memory only.",
      "A different key for each site: that is in the design, not in the prototype.",
      "That it is ready for real logins: the design has not been reviewed.",
    ],
  },
  {
    id: "sign-in-as-member",
    title: "Sign in as a member, without saying who",
    summary:
      "In the design, a site could learn only that a member of a group signed in, using the membership proof TET already has. Design only; not built for sign-in.",
    status: "idea",
    evidence: [{ path: "docs/plans/SIGN_IN_WITH_TET.md" }],
    shows: ["If it were built: a member of this group answered this site's question."],
    doesNot: [
      "Which member answered.",
      "Anything today: no sign-in code uses the membership proof.",
      "That the design is reviewed: it is not.",
    ],
  },
  {
    id: "key-on-device",
    title: "Where your key lives",
    summary:
      "An idea, not decided: your key is made and kept inside a phone's secure hardware and never leaves it. A site sees that this key answered, not your name. None of this is built.",
    status: "idea",
    evidence: [],
    shows: ["If it were built: this key answered this site's question. Nothing is built, so today it shows nothing."],
    doesNot: [
      "Your name: a site learns a key, not who you are.",
      "Whether a phone's secure hardware can hold TET's two-part key (Ed25519 and ML-DSA-44). That has not been checked.",
      "How it would fit with the 12 words. A key that never leaves the hardware cannot be written down, so getting it back after losing the phone would work differently. Not decided.",
      "That anything here works today: no code keeps a TET key in a phone's secure hardware.",
    ],
  },
];
