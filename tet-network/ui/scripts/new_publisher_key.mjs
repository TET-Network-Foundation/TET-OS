// Make a new TET publisher key (the ID that marks TET's own documents), interactively.
//
//   cd tet-network/ui && node scripts/new_publisher_key.mjs
//
// Run it yourself, in your own Terminal window. It:
// 1. refuses to run unless it is attached to an interactive terminal (so the words can't land in a
//    pipe, a log file or another program's output);
// 2. shows the 12 words ONCE, written straight to the terminal device (/dev/tty), never to stdout;
// 3. clears the screen, then asks you to type 3 of them back (chosen at random) to confirm you wrote
//    them down; a wrong answer stops it and saves nothing;
// 4. clears the screen and its scrollback again, and saves the key to ~/.tet/tet-publisher.words
//    (mode 600, directory 700), atomically. An existing key there is not overwritten: it is renamed
//    to tet-publisher.words.old-<time>, to be deleted once the paper is re-marked.
// After the confirmation it prints only the new publisher ID (a public key), never the words. It
// makes no network request and takes nothing from arguments or the environment except
// TET_PUBLISHER_WORDS (another file path, if you want one).

import { openSync, writeSync, closeSync, existsSync, mkdirSync, renameSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { ReadStream } from "node:tty";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { randomInt } from "node:crypto";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2";

ed.hashes.sha512 = (m) => new Uint8Array(sha512(m));

const PATH = process.env.TET_PUBLISHER_WORDS || join(homedir(), ".tet", "tet-publisher.words");

// 1. An interactive terminal only.
let ttyFd;
try {
  ttyFd = openSync("/dev/tty", "r+");
} catch {
  ttyFd = -1;
}
if (ttyFd < 0 || !process.stdin.isTTY || !new ReadStream(ttyFd).isTTY) {
  process.stderr.write("new_publisher_key: run this in an interactive terminal window (no pipes, no redirection).\n");
  process.exit(2);
}
const say = (s) => writeSync(ttyFd, s);
const CLEAR = "\x1b[3J\x1b[H\x1b[2J"; // scrollback, home, screen

const input = createInterface({ input: new ReadStream(ttyFd), output: undefined, terminal: false });
const lines = input[Symbol.asyncIterator]();
async function ask(prompt) {
  say(prompt);
  const r = await lines.next();
  return r.done ? "" : String(r.value);
}

function finish(code, message) {
  say(CLEAR);
  if (message) say(message + "\n");
  input.close();
  closeSync(ttyFd);
  process.exit(code);
}

say(CLEAR);
say("TET publisher key\n\n");
say(`This makes TET's marking key and saves it to ${PATH}.\n`);
if (existsSync(PATH)) say("A key is already there; it will be kept as an .old file, not overwritten.\n");
say("Write the 12 words down on paper. They are shown once, here, and nowhere else.\n\n");
const go = await ask("Press Enter when you are ready to see them (or type q to stop): ");
if (go.trim().toLowerCase() === "q") finish(1, "Stopped. Nothing was saved.");

// 2. The words, once, to the terminal only.
const words = generateMnemonic(wordlist, 128);
const list = words.split(" ");
if (list.length !== 12 || !validateMnemonic(words, wordlist)) finish(1, "Internal error: bad word list. Nothing was saved.");
say(CLEAR);
say("Your 12 words (write them down now):\n\n");
list.forEach((w, i) => say(`  ${String(i + 1).padStart(2)}. ${w}\n`));
say("\n");
await ask("Press Enter once they are written down. The screen will be cleared. ");

// 3. Confirm 3 of them.
say(CLEAR);
const picks = [];
while (picks.length < 3) {
  const n = randomInt(0, 12);
  if (!picks.includes(n)) picks.push(n);
}
picks.sort((a, b) => a - b);
say("Confirm from your paper.\n\n");
for (const n of picks) {
  const typed = (await ask(`Word ${n + 1}: `)).trim().toLowerCase();
  if (typed !== list[n]) finish(1, "That doesn't match. Nothing was saved. Run it again for a new key.");
}

// 4. Save (atomically, 600), keeping any old key aside.
mkdirSync(dirname(PATH), { recursive: true, mode: 0o700 });
chmodSync(dirname(PATH), 0o700);
let kept = "";
if (existsSync(PATH)) {
  kept = `${PATH}.old-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  renameSync(PATH, kept);
  chmodSync(kept, 0o600);
}
const tmp = `${PATH}.tmp-${process.pid}`;
writeFileSync(tmp, words + "\n", { mode: 0o600 });
chmodSync(tmp, 0o600);
renameSync(tmp, PATH);
if (readFileSync(PATH, "utf8").trim() !== words) finish(1, "The saved file doesn't read back the same. Check the disk.");

// The public ID only (the Ed25519 public key from the seed's initial 32 bytes, as tet-core does).
const seed = mnemonicToSeedSync(words, "");
const id = Buffer.from(await ed.getPublicKeyAsync(seed.slice(0, 32))).toString("hex");
finish(
  0,
  `Saved: ${PATH} (mode 600).\n` +
    (kept ? `The previous key was moved to ${kept}.\n` : "") +
    `New publisher ID: ${id}\n\nTell Claude it's done; the words stay only on your paper and in that file.`,
);
