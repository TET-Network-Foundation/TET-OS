/** The machines section: its card on the home page, and every feature it names (with a status). */
import type { Feature, Section } from "../types";

export const SECTION: Section = {
  href: "/machines",
  title: "Machines and agents",
  sentence: "A machine or an agent holds its own key, signs what it does, and may use a one-time permission only once.",
};

/** notebook.py's SHOWS / DOES_NOT_SHOW, word for word (tools/machine-notebook/notebook.py). */
const NOTEBOOK_SHOWS = [
  "which key signed each record",
  "that the records are in this order",
  "that each record was written before the next one",
  "that no one-time permission was used twice in this log, or after it ran out",
];
const NOTEBOOK_DOES_NOT = [
  "that the reading is true",
  "that the machine's clock was right",
  "where the machine was",
  "who runs the machine",
  "that the key was not copied",
  "that a copied key did not use the same permission in another log",
];

export const FEATURES: Feature[] = [
  {
    id: "machine-notebook",
    title: "A machine's own log",
    summary:
      "A small program on the machine writes down each reading, signs it with the machine's own key, and links it to the record before. Anyone given the folder can check it later.",
    status: "prototype",
    evidence: [{ path: "tools/machine-notebook/notebook.py" }, { path: "tools/machine-notebook/README.md" }],
    shows: NOTEBOOK_SHOWS,
    doesNot: NOTEBOOK_DOES_NOT,
  },
  {
    id: "machine-log-check",
    title: "Check a log in your browser",
    summary: "Drop a machine's folder on the page, or try a sample. The check runs in your browser tab; nothing is uploaded.",
    status: "prototype",
    evidence: [
      { path: "tet-network/ui/app/try/MachineLogPanel.tsx" },
      { path: "tet-network/ui/app/lib/machine_log.mjs" },
      { pr: 179, what: "the machine-log tab on /try" },
    ],
    shows: ["whether the log checks out, by the same rules as the notebook's own check", "the reason, when it does not"],
    doesNot: ["that the reading is true", "who runs the machine", "anything about a log you were not given"],
    link: { href: "/try?tab=machine-log", label: "Check a machine's log" },
  },
  {
    id: "log-fingerprint",
    title: "A record's fingerprint on a node",
    summary:
      "The notebook can hand one record's fingerprint (its SHA-256) to a node you name. The reading itself stays on the machine. Tried only against a node run on the same computer.",
    status: "prototype",
    evidence: [{ path: "tools/machine-notebook/README.md" }, { path: "tools/machine-notebook/notebook.py" }],
    shows: ["whether each record's fingerprint is on the node you named, signed by this machine's key"],
    doesNot: ["the reading itself", "when the record was written: blocks carry no time", "a record fixed in a block: the notebook cannot do that step"],
  },
  {
    id: "one-time-permits",
    title: "One-time permits",
    summary:
      "The machine signs a short note: one named action may be recorded once, up to a given record number. A record cites the note. A second use, or a late one, makes the log fail its check.",
    status: "prototype",
    evidence: [{ path: "tools/machine-notebook/notebook.py" }, { path: "tools/machine-notebook/test_notebook.py" }],
    shows: ["which record used the permit", "that it was used once in this log, and not after it ran out", "that the machine's own key signed it"],
    doesNot: ["that the action really happened: the log holds the machine's claim", "that a copied key did not use the same permission in another log", "that the action was a good idea"],
  },
  {
    id: "agent-permit-once",
    title: "An agent action allowed once",
    summary:
      "An example in which a software agent claims a permit before it acts, and acts only if the claim is accepted. A second claim is refused, so the agent does not act again.",
    status: "prototype",
    evidence: [{ path: "tet-agent-sdk/examples/agent_permit_once.mjs" }, { path: "tet-agent-sdk/examples/AGENT_PERMITS.md" }],
    shows: [
      "which key claimed the permit, and in which record",
      "that this key's log accepts the action once, and not after it runs out",
      "that a log using a permit twice, late, or signed by another key is refused",
    ],
    doesNot: ["that a copied key did not write a second log", "that the action happened, or happened only once in the world", "who runs the agent, or that its clock was right"],
  },
  {
    id: "agent-signatures",
    title: "Agent signatures",
    summary:
      "An agent, such as a bot or a script, holds its own key and signs what it sends (tet-cli agent sign). Anyone can check the signature (tet-cli agent verify). Each signature names the chain it was made for.",
    status: "prototype",
    evidence: [{ path: "docs/AGENT_IDENTITY.md" }, { path: "tet-cli/src/main.rs" }, { path: "tet-agent-sdk/src/agent.ts" }],
    shows: ["which key signed these bytes", "that the bytes have not changed since", "which chain the signature was made for"],
    doesNot: ["who or what wrote the words", "that the key was not copied", "that the owner still stands behind the key: there is no way to withdraw one"],
  },
  {
    id: "agents-control",
    title: "All your machines on one page",
    summary:
      "A page that checks several machines' logs side by side, shows each one-time permit as used, still open or run out, and writes the command that gives a machine a new one. The page signs nothing.",
    status: "prototype",
    evidence: [{ pr: 183, what: "the /agents page" }],
    shows: ["each machine's result, VALID or INVALID", "which permits are used, still open, or run out"],
    doesNot: ["that the reading is true", "that a copied key did not use the same permission in another log", "anything about a machine whose folder you did not add"],
    link: { href: "/agents", label: "Open the machines page" },
  },
  {
    id: "once-in-the-world",
    title: "Once in the world, not just once per log",
    summary:
      "Today a permit means once per log. Making it once everywhere would need a shared record keeper, such as a node or the chain. This is an open question in a design note.",
    status: "idea",
    evidence: [{ branch: "docs/design-memo-manu", what: "design note, open question 4, not reviewed" }],
    shows: ["the question, written down"],
    doesNot: ["an answer: nothing is decided or built"],
  },
];
