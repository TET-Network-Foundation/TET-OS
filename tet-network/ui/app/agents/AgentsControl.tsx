"use client";

/**
 * /agents, "Agent and machine control" (prototype, local only). One plain sentence says what the page
 * is for. "Try with a sample" adds the two bundled sample machines (lib/machine_log_samples.mjs, the
 * real notebook.py and tet-cli); the visitor's own notebook folders, one per machine, can be dropped
 * or chosen. Each is checked in this tab exactly as on the try page (lib/machine_log.mjs, notebook.py
 * verify): the result first (colour, VALID / INVALID, one sentence), then its one-time permissions and
 * what state each is in (lib/agents_control.mjs, permitStates); key id, reasons, permission ids and
 * chain behind "Show details"; under every verdict Shows / Does not show, word for word notebook.py's.
 *
 * A permission is never made here: the page builds the `notebook.py permit` command to run on the
 * machine, which holds device.key. Nothing is uploaded, and device.key is never opened.
 * scripts/agents_control_guard.mjs pins all of this.
 */
import { useRef, useState, type ReactNode } from "react";
import { DOES_NOT_SHOW, MAX_PERMITS, SHOWS } from "../lib/machine_log.mjs";
import { permitCommand, permitStates } from "../lib/agents_control.mjs";
import { readDrop, readPicked } from "../lib/dropped_folder";
import { checkFolder, checkSamples, headline, ResultDetails, type Checked } from "../try/MachineLogPanel";
import { LangProvider, LangSwitch, useLang, type T } from "../try/i18n";
import { DropZone, PlainCard, PlainLead, PlainPage, PrimaryButton, ResultCard, SecondaryButton, ShowsBlock, TextField } from "../components/plain/Plain";

export type Device = Checked & { key: number };

/** The status line at the top of the page. */
export function StatusLine(props: { t: T }) {
  const { t } = props;
  return (
    <span>
      {t("Status:")} <strong>{t("prototype, local only")}</strong>
    </span>
  );
}

export const LEAD = "See each of your machines' diaries side by side: whether it checks out, and which of its one-time permissions are used, still open, or run out.";

/** The title, the status and the one plain sentence. */
export function AgentsLead(props: { t: T }) {
  const { t } = props;
  return (
    <PlainLead
      status={<StatusLine t={t} />}
      title={t("Agent and machine control")}
      lead={t("See each of your machines' diaries side by side: whether it checks out, and which of its one-time permissions are used, still open, or run out.")}
    />
  );
}

/** "1 record", "{n} records": English needs the singular; ja and zh-HK have one form. */
export function recordsLabel(n: number, t: T): string {
  return n === 1 ? t("1 record") : t("{n} records", { n });
}

const STATE_STYLE = {
  used: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-50",
  unused: "bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-50",
  expired: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  refused: "bg-rose-100 text-rose-900 dark:bg-rose-900 dark:text-rose-50",
} as const;

/** What sits behind "Show details": the key id, the check's own details, the permission ids. */
export function DeviceDetails(props: { device: Device; t: T }) {
  const { device, t } = props;
  const r = device.result;
  const states =
    r && r.kind === "verdict"
      ? permitStates({ records: r.records, permits: r.permits.flatMap((p) => (p.permit ? [p.permit] : [])), citations: r.citations })
      : [];
  const foreign = r && r.kind === "verdict" ? r.permits.filter((p) => !p.permit) : [];
  return (
    r && r.kind === "verdict" ? (
      <div className="flex flex-col gap-3">
        <p translate="no" className="break-all font-mono text-sm">
          {r.keyid ?? r.signer ?? t("no key id (the folder has no device.keyid)")}
        </p>
        <ResultDetails c={device} t={t} />
        {states.length || foreign.length ? (
          <div>
            <p className="font-semibold">{t("Permission ids")}</p>
            <ul translate="no" className="mt-1 flex flex-col gap-1 font-mono text-sm">
              {states.map((p) => (
                <li key={p.permitId} className="break-all">
                  {p.permitId} ({p.action})
                </li>
              ))}
              {foreign.map((p) => (
                <li key={p.permitId} className="break-all">
                  {p.why}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    ) : r ? (
      <ResultDetails c={device} t={t} />
    ) : null
  );
}

/** One machine: its result first, then its one-time permissions, then Shows / Does not show. */
export function DeviceCard(props: { device: Device; t: T; onPermit?: (folder: string) => void }) {
  const { device, t } = props;
  const r = device.result;
  const states =
    r && r.kind === "verdict"
      ? permitStates({ records: r.records, permits: r.permits.flatMap((p) => (p.permit ? [p.permit] : [])), citations: r.citations })
      : [];
  const foreign = r && r.kind === "verdict" ? r.permits.filter((p) => !p.permit) : [];
  const caption =
    device.sample === "consistent"
      ? t("Sample 1: a greenhouse sensor's log")
      : device.sample === "reused"
        ? t("Sample 2: the same sensor, another log")
        : t("Your folder: {name}", { name: device.name });

  return (
    <li className="flex flex-col gap-2">
      <p className="text-base font-medium text-slate-600 dark:text-slate-300">
        {caption}
        {r && r.kind === "verdict" ? ` · ${recordsLabel(r.records, t)}` : ""}
      </p>
      {r?.hasDeviceKey ? (
        <p role="alert" className="rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-base leading-relaxed text-amber-950 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-50">
          {t("This folder holds device.key, the device's secret phrase. The page did not open it, and nothing was uploaded. Before you share this folder with anyone, remove device.key.")}
        </p>
      ) : null}
      {device.error ? (
        <p role="alert" className="rounded-xl border-2 border-rose-300 bg-rose-50 px-4 py-3 text-base text-rose-950 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-50">
          {device.error}
        </p>
      ) : null}
      {r ? (
        <ResultCard {...headline(r, t)} detailsLabel={t("Show details")} hideLabel={t("Hide details")} details={<DeviceDetails device={device} t={t} />}>
          {r.kind === "verdict" ? (
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="text-base font-semibold">{t("One-time permissions")}</h3>
                {r.permitsTooMany !== null ? (
                  <p className="mt-1">{t("This folder holds {n} permissions. This page lists up to {max}.", { n: r.permitsTooMany, max: MAX_PERMITS })}</p>
                ) : states.length || foreign.length ? (
                  <ul className="mt-2 flex flex-col gap-2">
                    {states.map((p) => (
                      <li key={p.permitId} className="flex flex-wrap items-center gap-2">
                        <span translate="no" className="font-mono font-semibold">
                          {p.action}
                        </span>
                        <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${STATE_STYLE[p.state]}`}>
                          {{ used: t("used"), unused: t("not used yet"), expired: t("ran out"), refused: t("refused") }[p.state]}
                        </span>
                        <span>
                          {p.state === "used"
                            ? t("by record {seq}", { seq: p.by ?? "" })
                            : p.state === "unused"
                              ? t("records up to number {exp} may use it", { exp: String(p.expiresSeq) })
                              : p.state === "expired"
                                ? t("it was open until record {exp}", { exp: String(p.expiresSeq) })
                                : t("record {seq} tried to use it and was refused; no later record may use it", { seq: p.by ?? "" })}
                        </span>
                      </li>
                    ))}
                    {foreign.map((p) => (
                      <li key={p.permitId}>
                        <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${STATE_STYLE.refused}`}>{t("not this machine's permission")}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1">{t("No one-time permissions in this folder.")}</p>
                )}
                {!r.valid && states.length ? <p className="mt-2 text-sm opacity-80">{t("This log is INVALID, so these states are read from records that did not all check out.")}</p> : null}
              </div>
              {props.onPermit ? (
                <div>
                  <SecondaryButton onClick={() => props.onPermit?.(device.name)}>{t("Give this machine a new one-time permission")}</SecondaryButton>
                </div>
              ) : null}
              <ShowsBlock showsTitle={t("Shows")} shows={SHOWS.map((s) => t(s))} doesNotTitle={t("Does not show")} doesNot={DOES_NOT_SHOW.map((s) => t(s))} />
            </div>
          ) : null}
        </ResultCard>
      ) : null}
    </li>
  );
}

/**
 * Put `text` on the clipboard: the Clipboard API, else the selection and execCommand("copy") (a page
 * served over plain http has no Clipboard API). True only when one of them reports success.
 */
export async function copyText(text: string, env: { clipboard?: { writeText: (s: string) => Promise<void> }; execCopy?: (s: string) => boolean }): Promise<boolean> {
  if (env.clipboard) {
    try {
      await env.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the selection */
    }
  }
  return env.execCopy ? env.execCopy(text) : false;
}

/** execCommand("copy") on a hidden textarea holding exactly `text`. */
function execCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** Give a machine a one-time permission: the command to run on the machine. Nothing is signed here. */
export function PermitPanel(props: { t: T; folder: string; setFolder: (v: string) => void }) {
  const { t } = props;
  const [action, setAction] = useState("");
  const [seq, setSeq] = useState("");
  const [copied, setCopied] = useState<"" | "yes" | "no">("");
  const typed = props.folder !== "" || action !== "" || seq !== "";
  const c = permitCommand({ dir: props.folder, action, expiresSeq: seq });
  return (
    <PlainCard className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t("Give a machine a new one-time permission")}</h2>
      <p className="text-base leading-relaxed">
        {t("This page signs nothing. The machine signs the permission with its own key when you run the command below on it. One record may use it, once, up to the record number you give.")}
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label={t("Folder on the machine")} value={props.folder} onChange={props.setFolder} mono placeholder="greenhouse-sensor" />
        <TextField label={t("What it allows")} value={action} onChange={setAction} mono placeholder="open-vent" />
        <TextField label={t("Last record that may use it")} value={seq} onChange={setSeq} mono inputMode="numeric" placeholder="10" />
      </div>
      {c.ok ? (
        <div className="flex flex-col gap-3">
          <p className="text-base">{t("Run this on the machine:")}</p>
          <pre translate="no" className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-slate-100 px-4 py-3 font-mono text-sm dark:bg-slate-800">
            {c.command}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <SecondaryButton
              onClick={() => {
                void copyText(c.command, { clipboard: navigator.clipboard, execCopy }).then((ok) => {
                  setCopied(ok ? "yes" : "no");
                  if (ok) setTimeout(() => setCopied(""), 2000);
                });
              }}
            >
              {copied === "yes" ? t("Copied") : t("Copy the command")}
            </SecondaryButton>
            {copied === "no" ? <p role="alert">{t("This browser did not let the page copy. Select the command and copy it yourself.")}</p> : null}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">{t("It prints the new permission's id. A record uses it with: notebook.py record --permit <id>")}</p>
        </div>
      ) : typed ? (
        <p role="alert" translate="no" className="font-mono text-sm text-rose-800 dark:text-rose-200">
          {c.why}
        </p>
      ) : null}
    </PlainCard>
  );
}

/** The page, with its language passed in (the guard renders it in English and Japanese). */
export function AgentsBody(props: { t: T; initial?: Device[] }) {
  const { t } = props;
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<Device[]>(props.initial ?? []);
  const [folder, setFolder] = useState("");
  const next = useRef((props.initial ?? []).length + 1);
  const folderInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);

  async function add(job: () => Promise<Checked[]>) {
    setBusy(true);
    try {
      const got = (await job()).map((c) => ({ ...c, key: next.current++ }));
      setDevices((d) => [...d, ...got]);
    } finally {
      setBusy(false);
    }
  }

  function onPick(list: FileList | null) {
    const f = list ? readPicked(list) : null;
    if (f) void add(async () => [await checkFolder({ ...f, name: f.name ?? t("chosen files") }, t)]);
  }

  return (
    <>
      <div className="flex justify-end">
        <LangSwitch />
      </div>
      <AgentsLead t={t} />
      <PlainCard className="flex flex-col gap-5">
        <div className="flex flex-col items-start gap-2">
          <PrimaryButton onClick={() => void add(() => checkSamples())} disabled={busy}>
            {t("Try with a sample")}
          </PrimaryButton>
          <p className="text-base text-slate-600 dark:text-slate-300">
            {t("Two small logs from a test machine: one that checks out, and one where a one-time permission was used twice.")}
          </p>
        </div>
        <DropZone
          label={t("Drop one or more notebook folders here")}
          onDrop={(dt) => {
            const drop = readDrop(dt);
            // Each dropped folder is one machine; loose files dropped together are one more.
            void add(async () => Promise.all((await drop).map((f) => checkFolder(f, t))));
          }}
        >
          <p className="text-lg font-semibold">{t("Or add your own: drop one or more machine folders here, one folder per machine")}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            <SecondaryButton onClick={() => folderInput.current?.click()} disabled={busy}>
              {t("Choose a folder")}
            </SecondaryButton>
            <SecondaryButton onClick={() => filesInput.current?.click()} disabled={busy}>
              {t("Choose its files")}
            </SecondaryButton>
          </div>
          <input ref={folderInput} data-pick="folder" type="file" className="sr-only" tabIndex={-1} aria-hidden="true" multiple {...{ webkitdirectory: "" }} onChange={(e) => onPick(e.target.files)} />
          <input ref={filesInput} data-pick="files" type="file" className="sr-only" tabIndex={-1} aria-hidden="true" multiple onChange={(e) => onPick(e.target.files)} />
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{t("On a phone, choose every file of one folder, including the ones inside its subfolders; each choice adds one machine.")}</p>
        </DropZone>
        <p className="text-base text-slate-600 dark:text-slate-300">{t("Nothing is uploaded. The folders are read and checked in this tab; no file leaves your browser.")}</p>
      </PlainCard>

      {busy ? <p className="text-lg">{t("Checking…")}</p> : null}

      {devices.length ? (
        <section aria-label={t("Machines")} aria-live="polite" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold">{t("Machines ({n})", { n: devices.length })}</h2>
            <SecondaryButton onClick={() => setDevices([])}>{t("Clear the list")}</SecondaryButton>
          </div>
          <ul className="flex flex-col gap-8">
            {devices.map((d) => (
              <DeviceCard key={d.key} device={d} t={t} onPermit={setFolder} />
            ))}
          </ul>
        </section>
      ) : null}

      <PermitPanel t={t} folder={folder} setFolder={setFolder} />
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t("The page never opens device.key, the device's secret phrase.")} {t("To make a log: tools/machine-notebook in the TET repository.")}
      </p>
    </>
  );
}

function Page() {
  const { t } = useLang();
  return <AgentsBody t={t} />;
}

export default function AgentsControl(): ReactNode {
  return (
    <PlainPage>
      <LangProvider>
        <Page />
      </LangProvider>
    </PlainPage>
  );
}
