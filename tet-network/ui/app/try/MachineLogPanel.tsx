"use client";

/**
 * Try TET: check a machine's log. One plain sentence says what the tab is for; "Try with a sample"
 * checks two logs bundled with the page (lib/machine_log_samples.mjs, made by the real notebook.py and
 * tet-cli under a throwaway test key); the visitor's own notebook folder can be dropped or chosen.
 *
 * Each result leads with a colour, VALID / INVALID and one short sentence. The reasons, key ids,
 * permits and chain are behind "Show details". Under every verdict: Shows / Does not show, word for
 * word notebook.py's lists. The check is `notebook.py verify`'s (lib/machine_log.mjs). Nothing is
 * uploaded, and device.key is never opened. scripts/try_machine_log_guard.mjs pins all of this.
 */
import { useRef, useState, type ReactNode } from "react";
import {
  base64Folder,
  checkMachineLog,
  DOES_NOT_SHOW,
  MAX_RECORDS,
  notebookPaths,
  problemLine,
  SHOWS,
  useLine,
  verdictKind,
} from "../lib/machine_log.mjs";
import { MAX_FILES, readDrop, readPicked, type DroppedFolder } from "../lib/dropped_folder";
import { mldsa44Verify } from "../lib/pqc";
import { Details, DropZone, PlainCard, PlainLead, PrimaryButton, ResultCard, SecondaryButton, ShowsBlock, type PlainTone } from "../components/plain/Plain";
import { useLang, type T } from "./i18n";

export type Result = Awaited<ReturnType<typeof checkMachineLog>>;
/** One checked folder. `sample`: which bundled sample it is, else null (the visitor's own). */
export type Checked = { name: string; files: number; sample: "consistent" | "reused" | null; result: Result | null; error: string };
type Verify = (pub: string, sig: string, msg: Uint8Array) => Promise<boolean>;

/** A sentence with the command it names shown as code (a command is not translated). */
function cmd(text: string): ReactNode {
  return text.split(/(notebook\.py verify(?: --node)?)/).map((part, i) =>
    i % 2 ? (
      <code translate="no" key={i} className="font-mono text-[0.92em]">
        {part}
      </code>
    ) : (
      part
    ),
  );
}

/** Check the two bundled samples, exactly as a dropped folder is checked. */
export async function checkSamples(verify: Verify = mldsa44Verify): Promise<Checked[]> {
  const { MACHINE_LOG_SAMPLES } = await import("../lib/machine_log_samples.mjs");
  const out: Checked[] = [];
  for (const s of MACHINE_LOG_SAMPLES.samples) {
    const f = base64Folder(s.files);
    out.push({ name: s.folder, files: f.paths.length, sample: s.id as "consistent" | "reused", result: await checkMachineLog({ ...f, mldsa44Verify: verify }), error: "" });
  }
  return out;
}

/** Check one dropped or picked folder. Files are read only when the check asks; never device.key. */
export async function checkFolder(folder: DroppedFolder, t: T, verify: Verify = mldsa44Verify): Promise<Checked> {
  const name = folder.name ?? t("dropped files");
  const base = { name, files: folder.files.size, sample: null, result: null };
  if (folder.error === "too_many") return { ...base, error: t("This folder holds more than {n} files. This page checks logs of up to {max} records; use notebook.py verify for a longer one.", { n: MAX_FILES, max: MAX_RECORDS }) };
  if (folder.error) return { ...base, error: t("The folder could not be read.") };
  const raw = [...folder.files.keys()];
  const paths: string[] = notebookPaths(raw);
  const byPath = new Map(paths.map((p: string, i: number) => [p, folder.files.get(raw[i]) as File]));
  try {
    const result = await checkMachineLog({ paths, read: async (p: string) => new Uint8Array(await (byPath.get(p) as File).arrayBuffer()), mldsa44Verify: verify });
    return { ...base, result, error: "" };
  } catch (e: unknown) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The label, colour and one short sentence a result leads with. */
export function headline(r: Result, t: T): { tone: PlainTone; label: string; sentence: string } {
  const kind = verdictKind(r);
  if (kind === "not_checked") {
    return {
      tone: "neutral",
      label: "NOT CHECKED",
      sentence: r.kind === "error" && r.error === "too_many" ? t("This log is too long to check here.") : t("This folder cannot be checked: it does not say which chain it belongs to."),
    };
  }
  if (kind === "consistent") {
    const n = r.kind === "verdict" ? r.uses.length : 0;
    return {
      tone: "ok",
      label: "VALID",
      sentence: n === 0 ? t("This log is consistent.") : n === 1 ? t("This log is consistent, and its one-time permission was used once.") : t("This log is consistent, and each of its one-time permissions was used once."),
    };
  }
  return {
    tone: "bad",
    label: "INVALID",
    sentence:
      kind === "reused"
        ? t("A one-time permission in this log was used twice.")
        : kind === "expired"
          ? t("A one-time permission in this log was used after it ran out.")
          : t("This log does not check out."),
  };
}

/** What sits behind "Show details": the reasons as notebook.py prints them, the key, permits, chain. */
export function ResultDetails(props: { c: Checked; t: T }) {
  const { c, t } = props;
  const r = c.result;
  if (!r) return null;
  return (
    <div className="flex flex-col gap-3">
      <p translate="no" className="break-all font-mono text-sm opacity-80">
        {t("{name} · {n} files", { name: c.name, n: c.files })}
      </p>
      {r.kind === "error" ? (
        <p>
          {cmd(r.error === "no_chain"
            ? t("This folder has no usable chain.json, so there is no chain to check the signatures against. notebook.py verify stops here too.")
            : t("This log has {n} records. This page checks logs of up to {max} records; use notebook.py verify for a longer one.", { n: r.records, max: MAX_RECORDS }))}
        </p>
      ) : r.valid ? (
        <div>
          <p className="break-words">{t("{n} records, all signed by {key}", { n: r.records, key: r.signer ?? "" })}</p>
          {r.uses.length ? (
            <ul translate="no" className="mt-1 flex flex-col gap-1 font-mono text-sm">
              {r.uses.map((u, i) => (
                <li key={i} className="break-all">
                  {useLine(u)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div>
          <p className="font-semibold">{t("Why:")}</p>
          <ul translate="no" className="mt-1 flex flex-col gap-1 font-mono text-sm">
            {r.problems.map((p, i) => (
              <li key={i} className="break-all">
                {problemLine(p)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-sm opacity-80">{cmd(t("The reasons are worded as notebook.py verify prints them."))}</p>
        </div>
      )}
      {r.kind === "verdict" && r.chain ? (
        <p className="break-all text-sm opacity-80">{t("Checked against chain {chain}, from the folder's chain.json.", { chain: `${r.chain.chainId} (${r.chain.genesisHash.slice(0, 14)}…)` })}</p>
      ) : null}
    </div>
  );
}

/** One result: which folder, then the result card (label, sentence, details fold, the two lists). */
export function ResultView(props: { c: Checked; t: T }) {
  const { c, t } = props;
  const r = c.result;
  const caption =
    c.sample === "consistent"
      ? t("Sample 1: a greenhouse sensor's log")
      : c.sample === "reused"
        ? t("Sample 2: the same sensor, another log")
        : t("Your folder: {name}", { name: c.name });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-base font-medium text-slate-600 dark:text-slate-300">{caption}</p>
      {r?.hasDeviceKey ? (
        <p role="alert" className="rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-base leading-relaxed text-amber-950 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-50">
          {t("This folder holds device.key, the device's secret phrase. The page did not open it, and nothing was uploaded. Before you share this folder with anyone, remove device.key.")}
        </p>
      ) : null}
      {c.error ? (
        <p role="alert" className="rounded-xl border-2 border-rose-300 bg-rose-50 px-4 py-3 text-base text-rose-950 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-50">
          {cmd(c.error)}
        </p>
      ) : null}
      {r ? (
        <ResultCard {...headline(r, t)} detailsLabel={t("Show details")} hideLabel={t("Hide details")} details={<ResultDetails c={c} t={t} />}>
          {r.kind === "verdict" ? (
            <ShowsBlock showsTitle={t("Shows")} shows={SHOWS.map((s) => t(s))} doesNotTitle={t("Does not show")} doesNot={DOES_NOT_SHOW.map((s) => t(s))} />
          ) : null}
        </ResultCard>
      ) : null}
    </div>
  );
}

export const LEAD = "Some machines keep a signed diary of what they did. Check one here: you will see whether its records are intact and in order, and whether a one-time permission in it was used twice.";

/** The title and the one plain sentence. */
export function MachineLogLead(props: { t: T }) {
  const { t } = props;
  return (
    <PlainLead
      title={t("Check a machine's log")}
      lead={t("Some machines keep a signed diary of what they did. Check one here: you will see whether its records are intact and in order, and whether a one-time permission in it was used twice.")}
    />
  );
}

/** The tab, with its language passed in (the guard renders it in English and Japanese). */
export function MachineLogBody(props: { t: T; initial?: Checked[] }) {
  const { t } = props;
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Checked[]>(props.initial ?? []);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  async function run(job: () => Promise<Checked[]>) {
    setResults([]);
    setBusy(true);
    try {
      setResults(await job());
    } finally {
      setBusy(false);
    }
  }

  function onPick(list: FileList | null) {
    const f = list ? readPicked(list) : null;
    if (f) void run(async () => [await checkFolder({ ...f, name: f.name ?? t("chosen files") }, t)]);
  }

  return (
    <section aria-label={t("Check a machine's log")} className="flex flex-col gap-6 px-4 pb-8 pt-3 md:px-5">
      <MachineLogLead t={t} />
      <PlainCard className="flex flex-col gap-5">
        <div className="flex flex-col items-start gap-2">
          <PrimaryButton onClick={() => void run(() => checkSamples())} disabled={busy}>
            {t("Try with a sample")}
          </PrimaryButton>
          <p className="text-base text-slate-600 dark:text-slate-300">
            {t("Two small logs from a test machine: one that checks out, and one where a one-time permission was used twice.")}
          </p>
        </div>
        <DropZone
          label={t("Drop the notebook folder here")}
          onDrop={(dt) => {
            const drop = readDrop(dt);
            void run(async () => {
              const folders = await drop;
              if (!folders.length) return [];
              // This tab checks one folder: the one dropped, or everything dropped, together.
              const one: DroppedFolder =
                folders.length === 1 ? folders[0] : { name: null, files: new Map(folders.flatMap((f) => [...f.files])), error: folders.find((f) => f.error)?.error };
              return [await checkFolder(one, t)];
            });
          }}
        >
          <p className="text-lg font-semibold">{t("Or check your own: drop the machine's folder here")}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            <SecondaryButton onClick={() => folderInput.current?.click()} disabled={busy}>
              {t("Choose the folder")}
            </SecondaryButton>
            <SecondaryButton onClick={() => filesInput.current?.click()} disabled={busy}>
              {t("Choose its files")}
            </SecondaryButton>
          </div>
          <input ref={folderInput} data-pick="folder" type="file" className="sr-only" tabIndex={-1} aria-hidden="true" multiple {...{ webkitdirectory: "" }} onChange={(e) => onPick(e.target.files)} />
          <input ref={filesInput} data-pick="files" type="file" className="sr-only" tabIndex={-1} aria-hidden="true" multiple onChange={(e) => onPick(e.target.files)} />
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{t("On a phone, choose every file in the folder, including the ones inside its subfolders.")}</p>
        </DropZone>
        <p className="text-base text-slate-600 dark:text-slate-300">{t("Nothing is uploaded. The folder is read and checked in this tab; no file leaves your browser.")}</p>
      </PlainCard>

      {busy ? <p className="text-lg">{t("Checking…")}</p> : null}
      {results.length ? (
        <div aria-live="polite" className="flex flex-col gap-6">
          {results.map((c, i) => (
            <ResultView key={i} c={c} t={t} />
          ))}
        </div>
      ) : null}

      <Details label={t("How this check works")} hideLabel={t("Hide details")}>
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>{cmd(t("A folder is checked the way notebook.py verify checks it, in this tab."))}</li>
          <li>{t("The page never opens device.key, the device's secret phrase.")}</li>
          <li>{cmd(t("The signatures are checked against the chain named in the folder's chain.json, as notebook.py verify does."))}</li>
          <li>{cmd(t("Anchors on chain are not checked here. notebook.py verify --node checks them against a node."))}</li>
          <li>{t("The samples were made by notebook.py and tet-cli with a test key that was thrown away.")}</li>
          <li>{t("To make a log: tools/machine-notebook in the TET repository.")}</li>
        </ul>
      </Details>
    </section>
  );
}

export default function MachineLogPanel() {
  const { t } = useLang();
  return <MachineLogBody t={t} />;
}
