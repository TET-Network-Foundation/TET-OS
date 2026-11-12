// "Agent and machine control" (/agents): the two pure rules behind the page, kept here so
// scripts/agents_control_guard.mjs tests them directly.
//
// 1. permitStates: what each of a device's permits is, read from the verdict lib/machine_log.mjs gives
//    for its notebook folder. notebook.py's semantics (tools/machine-notebook/notebook.py,
//    permit_problem and check_chain), nothing added:
//      - record seq may cite a permit only while seq <= expires_seq, and only if nothing cited it before;
//        check_chain counts a citation as the first one even when it was refused (used.setdefault);
//      - used: a record cited it and that citation checked out (permit_problem returned no reason);
//      - expired: not used, and no further record can cite it: the log already holds expires_seq or
//        more records, so the next record's seq is past expires_seq;
//      - cited, refused: not used, not expired, but a record already cited it and was refused (for
//        example, the permit was not this record's signer's). notebook.py counts that citation, so no
//        later record may cite it either; calling it unused would say it can still be cited, which
//        notebook.py would refuse;
//      - unused: none of the above: no record cited it and the next record may still cite it.
//
// 2. permitCommand: the `notebook.py permit` command for a device, validated as notebook.py validates
//    it (argparse, then cmd_permit), so the page never shows a command notebook.py would refuse at
//    these checks. The page signs nothing: the command runs on the device, which holds device.key.

/** cmd_permit's action rule: re.fullmatch(r"[A-Za-z0-9._-]{1,64}", action). */
export const PERMIT_ACTION = /^[A-Za-z0-9._-]{1,64}$/;

/** The `permit` subcommand's argparse names in notebook.py (the guard reads them from notebook.py). */
export const PERMIT_FLAGS = { dir: "--dir", action: "--action", expiresSeq: "--expires-seq" };

export const NOTEBOOK = "python3 tools/machine-notebook/notebook.py";

/**
 * @param {{ records: number,
 *           permits: { permitId: string, action: string, expiresSeq: bigint }[],
 *           citations: { seq: number, permitId: string | null, ok: boolean }[] }} o
 * @returns {{ permitId: string, action: string, expiresSeq: bigint,
 *             state: "used" | "expired" | "refused" | "unused", by: number | null }[]}
 *   `by`: the record that used it (used), or the record whose citation was refused (refused).
 */
export function permitStates(o) {
  return o.permits.map((p) => {
    const mine = o.citations.filter((c) => c.permitId === p.permitId).sort((a, b) => a.seq - b.seq);
    const ok = mine.find((c) => c.ok === true);
    if (ok) return { ...p, state: "used", by: ok.seq };
    if (BigInt(o.records) >= BigInt(p.expiresSeq)) return { ...p, state: "expired", by: null };
    if (mine.length) return { ...p, state: "refused", by: mine[0].seq };
    return { ...p, state: "unused", by: null };
  });
}

/** Python's shlex.quote: the argument as one shell word. */
export function shQuote(s) {
  if (s === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

/** argparse's test for a value that looks like a negative number (and so is not read as an option). */
const NEGATIVE_NUMBER = /^-\d+$|^-\d*\.\d+$/;

/** Python repr() of a str, for argparse's "invalid int value: '…'". */
function pyRepr(v) {
  const q = v.includes("'") && !v.includes('"') ? '"' : "'";
  return q + v.replace(/\\/g, "\\\\").replace(new RegExp(q, "g"), `\\${q}`) + q;
}

/**
 * The command for `notebook.py permit`, or why notebook.py would refuse it.
 *
 * Refused exactly where notebook.py refuses, with its wording where the refusal is its own:
 *   - --action: cmd_permit's "--action is a short name: 1 to 64 of A-Z a-z 0-9 . _ -";
 *   - --expires-seq: argparse's type=int (Python int(): surrounding whitespace, a sign, digits with
 *     single underscores between them), then cmd_permit's "must be 1 or more";
 *   - a value starting with "-" that argparse would read as an option (it needs an argument).
 * Stricter than notebook.py, on purpose (conservative): a folder that is empty, starts with "-", or holds
 * a control character is refused here (notebook.py would refuse an empty or missing folder only later,
 * at "no device key"); and --expires-seq takes ASCII digits only, where Python's int() also takes other
 * scripts' digits.
 *
 * @param {{ dir: string, action: string, expiresSeq: string }} o  as typed
 * @returns {{ ok: true, command: string, argv: string[] } | { ok: false, field: "dir" | "action" | "expiresSeq", why: string }}
 */
export function permitCommand(o) {
  const dir = String(o.dir ?? "");
  const action = String(o.action ?? "");
  const seqRaw = String(o.expiresSeq ?? "");
  if (!dir.trim()) return { ok: false, field: "dir", why: "the notebook folder on the device is needed" };
  if (/[\x00-\x1f\x7f]/.test(dir)) return { ok: false, field: "dir", why: "the folder holds a control character" };
  if (dir.startsWith("-")) return { ok: false, field: "dir", why: "a folder starting with - would be read as an option; write it as ./" + dir };
  if (action.startsWith("-") && !NEGATIVE_NUMBER.test(action)) return { ok: false, field: "action", why: "argument --action: expected one argument" };
  if (!PERMIT_ACTION.test(action)) return { ok: false, field: "action", why: "--action is a short name: 1 to 64 of A-Z a-z 0-9 . _ -" };
  if (seqRaw.startsWith("-") && !NEGATIVE_NUMBER.test(seqRaw)) return { ok: false, field: "expiresSeq", why: "argument --expires-seq: expected one argument" };
  const m = /^[ \t\n\r\f\v]*([+-]?)([0-9]+(?:_[0-9]+)*)[ \t\n\r\f\v]*$/.exec(seqRaw);
  if (!m) return { ok: false, field: "expiresSeq", why: `argument --expires-seq: invalid int value: ${pyRepr(seqRaw)}` };
  const n = BigInt(m[1] + m[2].replace(/_/g, ""));
  if (n < 1n) return { ok: false, field: "expiresSeq", why: "--expires-seq is the last record number that may cite the permit; it must be 1 or more" };
  const argv = ["permit", PERMIT_FLAGS.dir, dir, PERMIT_FLAGS.action, action, PERMIT_FLAGS.expiresSeq, n.toString()];
  return { ok: true, argv, command: `${NOTEBOOK} ${argv.map(shQuote).join(" ")}` };
}
