/** The tags section: its card on the home page, and every feature it names (with a status). */
import type { Feature, Section } from "../types";

export const SECTION: Section = {
  href: "/tags",
  title: "Genuine tags",
  sentence: "A maker puts a chip tag on what they make, and a buyer's tap shows whether that chip knows the maker's key.",
};

export const FEATURES: Feature[] = [
  {
    id: "tags-mark-genuine",
    title: "Mark a file or text as genuine, and check a copy",
    summary:
      "A maker marks a photo or a written description of their work with their ID and gets a short code. Anyone with the code can check whether their copy is exactly the one that was marked. It works on files and text, not on tags, and it runs on your own computer with a local node.",
    status: "prototype",
    evidence: [
      { path: "tet-network/ui/app/try/GenuinePanel.tsx" },
      { path: "tet-network/ui/app/try/GenuineCheck.tsx" },
      { path: "tet-network/ui/scripts/try_genuine_guard.mjs" },
    ],
    shows: ["This ID marked this exact file or text.", "When the node recorded the mark.", "Whether your copy matches it exactly, down to one changed letter."],
    doesNot: ["Who is behind the ID.", "That the content is original or true.", "Anything about a physical object or a tag."],
    link: { href: "/try?tab=genuine", label: "Open Mark as genuine" },
  },
  {
    id: "tags-tap-check",
    title: "Check one tap of a chip tag",
    summary:
      "A small program checks the link a secure NFC chip (NXP NTAG 424 DNA) writes each time it is tapped, using that tag's key, and refuses a counter it has already seen. It runs on your own computer. No phone page uses it yet, and it has been tested on published examples, not on a physical tag.",
    status: "prototype",
    evidence: [{ pr: 150, what: "tet-tag-verify: the tap check, its tests, and a local-only serve prototype" }],
    shows: [
      "The chip that made this link knew the tag's key when it was tapped.",
      "The tap's counter was higher than any this checker had accepted for that tag before.",
    ],
    doesNot: [
      "Anything about the object the tag is on.",
      "Who made the object.",
      "Whether the tag was moved from another object.",
      "Which tap was real, if a copied link reached the checker before the real tap did.",
      "That TET's chain checked anything: this check ran on one computer.",
    ],
  },
  {
    id: "tags-maker-register",
    title: "Register a tag under a maker's ID",
    summary:
      "A maker would sign a short record naming the tag, the product as the maker describes it, and the maker's checker, and publish it on TET. The record's format is written and tested; signing and publishing it are not built.",
    status: "planned",
    evidence: [
      { pr: 149, what: "docs/plans/GENUINE_TAG.md, the design" },
      { pr: 150, what: "the registration record's format, without signing or publishing" },
    ],
    shows: ["That the maker's ID registered this tag, and before which block."],
    doesNot: ["That the maker's description of the product is accurate.", "Who the person behind the maker's ID is."],
  },
  {
    id: "tags-scan-page",
    title: "A page that opens when you tap",
    summary:
      "Tapping a tag would open a page that asks the maker's checker about this tap, then shows the maker's ID, the product as it was registered, and the result. Not built.",
    status: "planned",
    evidence: [{ pr: 149, what: "docs/plans/GENUINE_TAG.md, the scan page" }],
    shows: ["Whether this tap was valid, as the maker's checker said just now.", "The maker's ID and the product as the maker registered it."],
    doesNot: [
      "That a QR code or a copied link is genuine: only a fresh tap counts.",
      "That TET's chain checked the tag: the chain records what the maker's checker said.",
    ],
  },
  {
    id: "tags-owner-record",
    title: "Who holds it now",
    summary:
      "Whoever taps the tag earliest after registration could record themselves as the owner. To pass it on, the owner signs a release and the next person taps the tag in person. Not built.",
    status: "planned",
    evidence: [{ pr: 149, what: "docs/plans/GENUINE_TAG.md, claims and transfers" }],
    shows: ["The order of owner records, each with the block it is in."],
    doesNot: ["Legal ownership: this is a record on TET, not a title.", "Who physically holds the object today."],
  },
];
