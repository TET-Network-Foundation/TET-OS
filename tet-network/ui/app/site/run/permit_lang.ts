/**
 * /research: a sketch of a permission language (docs/research/PERMIT_LANGUAGE.md, status idea). One
 * rule per line:
 *
 *   allow agent "<agent>" to "<action>" once, before block <N>
 *
 * Each rule becomes one one-time permit in that agent's own log (page_notebook.addPermit, the
 * machine notebook's permit), and is then run through the page's real permit check: the agent uses it
 * once, tries again, and any other agent in the text tries to use it too.
 *
 * In this sketch a "block" is a record number in the agent's log: `before block N` becomes the
 * notebook's `expires_seq` N - 1. No chain is involved. Every rule must say `once` and must have an
 * end: the notebook's permits are one-time and every one expires, and the sketch adds nothing the
 * permit cannot hold.
 */
import type { SiteT } from "../i18n";
import { makeTestKey, RUN_CHAIN, type Checkers } from "./page_key";
import { addPermit, addRecord, newNotebook, type Notebook } from "./page_notebook";
import type { Tone } from "./runs";

/** The most rules one run reads. A longer text is refused with this number named, never cut short. */
export const MAX_RULES = 12;

export const SAMPLE = `allow agent "shopper" to "buy" once, before block 5000
allow agent "mailer" to "send-email" once, before block 3`;

export type Rule = { line: number; agent: string; action: string; beforeBlock: number };
export type ParseError = { line: number; why: string; vars?: Record<string, number> };

const NAME = "[A-Za-z0-9._-]{1,32}";
const RULE = new RegExp(`^allow\\s+agent\\s+"(${NAME})"\\s+to\\s+"(${NAME})"\\s+once\\s*,?\\s+before\\s+block\\s+([0-9]{1,9})$`);

/** Parse the text: rules, or the errors with their line numbers (both may be non-empty). */
export function parse(text: string): { rules: Rule[]; errors: ParseError[] } {
  const rules: Rule[] = [];
  const errors: ParseError[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    const n = i + 1;
    if (!line || line.startsWith("#")) continue;
    const m = RULE.exec(line);
    if (m) {
      const beforeBlock = Number(m[3]);
      if (beforeBlock < 2) errors.push({ line: n, why: "before block 1 leaves no block to use it in" });
      else rules.push({ line: n, agent: m[1], action: m[2], beforeBlock });
      continue;
    }
    if (!/^allow\b/.test(line)) errors.push({ line: n, why: 'a rule starts with "allow"' });
    else if (/\b(twice|always|times|forever|unlimited)\b/.test(line) || !/\bonce\b/.test(line)) {
      errors.push({ line: n, why: 'only "once": every permit here is one-time' });
    } else if (!/\bbefore\s+block\b/.test(line)) errors.push({ line: n, why: 'a permit needs an end: add "before block <N>"' });
    else errors.push({ line: n, why: 'not understood; the form is: allow agent "name" to "action" once, before block N' });
  }
  if (rules.length > MAX_RULES) errors.push({ line: 0, why: "this sketch reads at most {max} rules; the text has {n}", vars: { max: MAX_RULES, n: rules.length } });
  return { rules, errors };
}

/** Turn each rule into a permit and run it through the permit check. */
export async function runRules(o: { rules: Rule[]; t: SiteT; log: (line: string, tone?: Tone) => (Promise<void>); c: Checkers }) {
  const { t, log, c } = o;
  if (o.rules.length > MAX_RULES) throw new Error(`at most ${MAX_RULES} rules`);
  const logs = new Map<string, Notebook>();
  for (const r of o.rules) {
    if (!logs.has(r.agent)) {
      logs.set(r.agent, newNotebook(await makeTestKey(), RUN_CHAIN));
      await log(t('Agent "{agent}": test key and log created in this tab.', { agent: r.agent }));
    }
  }
  for (const r of o.rules) {
    const nb = logs.get(r.agent)!;
    const pid = await addPermit(nb, r.action, r.beforeBlock - 1);
    await log(t('Line {line}: permit for "{agent}" to "{action}", once, open up to record {last}.', { line: r.line, agent: r.agent, action: r.action, last: r.beforeBlock - 1 }));
    const first = await addRecord(nb, { value: r.action, unit: "action" }, c, pid);
    await log(first.ok ? t("Used once: accepted.") : t("Used once: refused: {why}", { why: first.why.join("; ") }), first.ok ? "ok" : "refused");
    const again = await addRecord(nb, { value: r.action, unit: "action" }, c, pid);
    await log(again.ok ? t("Used again: accepted.") : t("Used again: refused: {why}", { why: again.why.join("; ") }), again.ok ? "ok" : "refused");
    for (const [other, onb] of logs) {
      if (other === r.agent) continue;
      const files = [`permits/${pid}.json`, `permits/${pid}.json.sig.json`];
      for (const p of files) onb.files.set(p, nb.files.get(p)!);
      const stolen = await addRecord(onb, { value: r.action, unit: "action" }, c, pid);
      for (const p of files) onb.files.delete(p);
      await log(
        stolen.ok ? t('"{other}" using this permit: accepted.', { other }) : t('"{other}" using this permit: refused: {why}', { other, why: stolen.why.join("; ") }),
        stolen.ok ? "ok" : "refused",
      );
    }
  }
}

export const PERMIT_LANG_SHOWS = [
  "Each line becomes one one-time permit, and the permit check accepts it once, refuses it the second time, and refuses it for any other agent.",
];
export const PERMIT_LANG_DOES_NOT = [
  "That this language is designed or decided: it is a sketch of an idea.",
  "That a block here is a chain block: in this sketch it is a record number in the agent's own log.",
  "Anything beyond one action, once: no conditions, no groups, no amounts.",
];
