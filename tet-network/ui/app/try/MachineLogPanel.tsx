"use client";

/**
 * Try TET: check a machine's log. The visitor drops a machine notebook folder (records, signatures,
 * permits, chain.json; tools/machine-notebook) and it is checked in this tab the way
 * `notebook.py verify` checks it: VALID or INVALID with the reasons, then the two lists, Shows and
 * Does not show, word for word notebook.py's. Nothing is uploaded, and device.key is never opened.
 * Rules in `lib/machine_log.mjs`; scripts/try_machine_log_guard.mjs pins the lists and the verdicts.
 */
import { useState, type DragEvent, type ReactNode } from "react";
import { checkMachineLog, DOES_NOT_SHOW, MAX_RECORDS, notebookPaths, problemLine, SHOWS } from "../lib/machine_log.mjs";
import { mldsa44Verify } from "../lib/pqc";
import { Badge, FOCUS, INK, PanelHead, PinnedNotice, cx } from "./ui";
import { useLang } from "./i18n";

type Result = Awaited<ReturnType<typeof checkMachineLog>>;

/** At most this many files are collected from a dropped folder (a notebook is ~2 per record). */
const MAX_FILES = 3 * MAX_RECORDS + 100;

class TooManyFiles extends Error {}

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

/** Every file under a dropped directory, by path. Stops (and says so) past MAX_FILES. */
async function walk(entry: FileSystemEntry, prefix: string, out: Map<string, File>): Promise<void> {
  if (out.size > MAX_FILES) throw new TooManyFiles();
  if (entry.isFile) {
    const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.set(prefix + entry.name, f);
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    // readEntries returns its entries in batches; an empty batch is the end.
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) return;
    for (const e of batch) await walk(e, `${prefix}${entry.name}/`, out);
  }
}

export default function MachineLogPanel() {
  const { t } = useLang();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [label, setLabel] = useState("");

  async function check(files: Map<string, File>, name: string) {
    setErr("");
    setResult(null);
    setBusy(true);
    try {
      const raw = [...files.keys()];
      const paths: string[] = notebookPaths(raw);
      const byPath = new Map(paths.map((p: string, i: number) => [p, files.get(raw[i]) as File]));
      setLabel(t("{name} · {n} files", { name, n: files.size }));
      setResult(
        await checkMachineLog({
          paths,
          // Read only when the check asks for a file; it never asks for device.key.
          read: async (p: string) => new Uint8Array(await (byPath.get(p) as File).arrayBuffer()),
          mldsa44Verify,
        }),
      );
    } catch (e: unknown) {
      setErr(e instanceof TooManyFiles ? t("This folder holds more than {n} files. This page checks logs of up to {max} records; use notebook.py verify for a longer one.", { n: MAX_FILES, max: MAX_RECORDS }) : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
    const files = new Map<string, File>();
    try {
      for (const en of entries) await walk(en, "", files);
    } catch (x: unknown) {
      setErr(x instanceof TooManyFiles ? t("This folder holds more than {n} files. This page checks logs of up to {max} records; use notebook.py verify for a longer one.", { n: MAX_FILES, max: MAX_RECORDS }) : t("The folder could not be read."));
      return;
    }
    const name = entries.length === 1 && entries[0].isDirectory ? entries[0].name : t("dropped files");
    await check(files, name);
  }

  function onPick(list: FileList | null) {
    if (!list || !list.length) return;
    const files = new Map<string, File>();
    for (const f of list) files.set(f.webkitRelativePath || f.name, f);
    const first = list[0].webkitRelativePath.split("/")[0];
    void check(files, first || t("chosen files"));
  }

  return (
    <section aria-label={t("Check a machine's log")}>
      <PanelHead title={t("Check a machine's log")} sub={t("checked in this tab")} todo={cmd(t("Drop a machine notebook folder here, or choose it. It is checked the way notebook.py verify checks it."))} />
      <div className="max-w-[46rem] space-y-3 px-4 pb-6 md:px-5">
        <PinnedNotice
          lines={[
            t("Nothing is uploaded. The folder is read and checked in this tab; no file leaves your browser."),
            t("The page never opens device.key, the device's secret phrase."),
            cmd(t("The signatures are checked against the chain named in the folder's chain.json, as notebook.py verify does.")),
            cmd(t("Anchors on chain are not checked here. notebook.py verify --node checks them against a node.")),
          ]}
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => void onDrop(e)}
          className={cx("rounded-md border-2 border-dashed px-4 py-6 text-center", over ? "border-[#1a237e] bg-[#f3f4fd]" : "border-[#c9ced4] bg-[#fafbfc]")}
        >
          <p className="text-base font-semibold">{t("Drop the notebook folder here")}</p>
          <p className="mt-1 text-[14px] text-[#5d646d]">{t("The folder that holds records/, permits/ and chain.json.")}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <label className={cx(FOCUS, "inline-flex min-h-11 cursor-pointer items-center rounded-md bg-[#1a237e] px-4 text-[15px] font-semibold text-white focus-within:ring-2 focus-within:ring-[#1a237e] focus-within:ring-offset-2")}>
              {t("Choose the folder")}
              <input type="file" className="sr-only" multiple {...{ webkitdirectory: "" }} onChange={(e) => onPick(e.target.files)} />
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-[#c9ced4] bg-white px-4 text-[15px] focus-within:ring-2 focus-within:ring-[#1a237e] focus-within:ring-offset-2">
              {t("Choose its files")}
              <input type="file" className="sr-only" multiple onChange={(e) => onPick(e.target.files)} />
            </label>
          </div>
          <p className="mt-2 text-[13.5px] text-[#5d646d]">{t("On a phone, choose all the files in the folder (records and permits included).")}</p>
        </div>

        {busy ? <p className="text-[15px]">{t("Checking…")}</p> : null}
        {err ? (
          <p role="alert" className={cx("text-[15px]", INK.bad)}>
            {cmd(err)}
          </p>
        ) : null}

        {result ? (
          <div aria-live="polite" className="space-y-3 border-t border-[#eceef1] pt-3">
            {label ? (
              <p translate="no" className="break-all font-mono text-[13px] text-[#5d646d]">
                {label}
              </p>
            ) : null}
            {result.hasDeviceKey ? (
              <p role="alert" className="rounded-md border border-[#e0b4b4] bg-[#fdf3f3] px-3 py-2 text-[15px] leading-relaxed text-[#8a1c1c]">
                {t("This folder holds device.key, the device's secret phrase. The page did not open it, and nothing was uploaded. Before you share this folder with anyone, remove device.key.")}
              </p>
            ) : null}
            {result.kind === "error" ? (
              <p role="alert" className={cx("text-[15px]", INK.bad)}>
                {cmd(result.error === "no_chain"
                  ? t("This folder has no usable chain.json, so there is no chain to check the signatures against. notebook.py verify stops here too.")
                  : t("This log has {n} records. This page checks logs of up to {max} records; use notebook.py verify for a longer one.", { n: result.records, max: MAX_RECORDS }))}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span translate="no" className={cx("font-mono text-[20px] font-bold", result.valid ? INK.ok : INK.bad)}>
                    {result.valid ? "VALID" : "INVALID"}
                  </span>
                  <Badge tone={result.valid ? "ok" : "bad"}>{result.valid ? t("the log checks out") : t("the log does not check out")}</Badge>
                </div>
                {result.valid ? (
                  <p className="break-words text-[15px] leading-relaxed">
                    {t("{n} records, all signed by {key}", { n: result.records, key: result.signer ?? "" })}
                  </p>
                ) : (
                  <div>
                    <p className="text-[15px] font-semibold">{t("Why:")}</p>
                    <ul translate="no" className="mt-1 space-y-1 font-mono text-[13px] leading-relaxed">
                      {result.problems.map((p, i) => (
                        <li key={i} className="break-all">
                          {problemLine(p)}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-[13.5px] text-[#5d646d]">{cmd(t("The reasons are worded as notebook.py verify prints them."))}</p>
                  </div>
                )}
                {result.chain ? (
                  <p className="break-all text-[14px] text-[#5d646d]">
                    {t("Checked against chain {chain}, from the folder's chain.json.", { chain: `${result.chain.chainId} (${result.chain.genesisHash.slice(0, 14)}…)` })}
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        <div className="grid gap-4 border-t border-[#eceef1] pt-3 sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-[15px] font-semibold">{t("Shows")}</h3>
            <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-[#3d434a]">
              {SHOWS.map((s) => (
                <li key={s}>{t(s)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-[15px] font-semibold">{t("Does not show")}</h3>
            <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-[#3d434a]">
              {DOES_NOT_SHOW.map((s) => (
                <li key={s}>{t(s)}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className="text-[13.5px] text-[#5d646d]">{t("To make a log: tools/machine-notebook in the TET repository.")}</p>
      </div>
    </section>
  );
}
