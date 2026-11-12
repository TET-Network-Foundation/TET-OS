"use client";

/**
 * /agents, "Agent and machine control" (prototype, local only). The visitor drops one or more machine
 * notebook folders (tools/machine-notebook), one per device. Each is checked in this tab exactly as on
 * the try page's "Check a machine's log" (lib/machine_log.mjs, notebook.py verify's checks): VALID or
 * INVALID with the reasons, its records, its permits and what state each is in (lib/agents_control.mjs,
 * permitStates), and under every verdict the two lists, Shows and Does not show, word for word
 * notebook.py's. A permit is never made here: the page builds the `notebook.py permit` command to run
 * on the device, which holds device.key. Nothing is uploaded, and device.key is never opened.
 * scripts/agents_control_guard.mjs pins all of this.
 */
import { useState, type DragEvent, type ReactNode } from "react";
import { checkMachineLog, DOES_NOT_SHOW, MAX_PERMITS, MAX_RECORDS, notebookPaths, problemLine, SHOWS } from "../lib/machine_log.mjs";
import { permitCommand, permitStates } from "../lib/agents_control.mjs";
import { mldsa44Verify } from "../lib/pqc";
import { MAX_FILES, TooManyFiles, walk } from "../try/MachineLogPanel";
import { LangProvider, LangSwitch, useLang, type T } from "../try/i18n";
import { Badge, Button, FOCUS, INK, Input, MONO, PinnedNotice, cx } from "../try/ui";

type Result = Awaited<ReturnType<typeof checkMachineLog>>;
export type Device = { key: number; label: string; files: number; result: Result | null; error: string };

/** The status line at the top of the page. */
export function StatusLine(props: { t: T }) {
  const { t } = props;
  return (
    <p className={cx(MONO, "text-[13.5px] text-[#6b4e00]")}>
      {t("Status:")} <strong>{t("prototype, local only")}</strong>
    </p>
  );
}

/** Shows / Does not show, notebook.py's lists through t(). Rendered under every verdict. */
export function ShowsLists(props: { t: T }) {
  const { t } = props;
  return (
    <div className="grid gap-3 border-t border-[#eceef1] pt-2 sm:grid-cols-2">
      <div>
        <h4 className="mb-1 text-[14px] font-semibold">{t("Shows")}</h4>
        <ul className="list-disc space-y-0.5 pl-5 text-[14px] leading-relaxed text-[#3d434a]">
          {SHOWS.map((s) => (
            <li key={s}>{t(s)}</li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="mb-1 text-[14px] font-semibold">{t("Does not show")}</h4>
        <ul className="list-disc space-y-0.5 pl-5 text-[14px] leading-relaxed text-[#3d434a]">
          {DOES_NOT_SHOW.map((s) => (
            <li key={s}>{t(s)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const STATE_TONE = { used: "ok", unused: "named", expired: "neutral", refused: "bad" } as const;

/** One device: its key id, records, permits and verdict, then Shows / Does not show. */
export function DeviceCard(props: { device: Device; t: T; onPermit?: (folder: string) => void }) {
  const { device, t } = props;
  const r = device.result;
  const keyid = r && r.kind === "verdict" ? (r.keyid ?? r.signer) : null;
  const states =
    r && r.kind === "verdict"
      ? permitStates({
          records: r.records,
          permits: r.permits.flatMap((p) => (p.permit ? [p.permit] : [])),
          citations: r.citations,
        })
      : [];
  const foreign = r && r.kind === "verdict" ? r.permits.filter((p) => !p.permit) : [];
  return (
    <li className="space-y-2 border-b border-[#e3e5e8] py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 translate="no" className={cx(MONO, "break-all text-[14px] font-semibold")}>
          {keyid ?? t("no key id (the folder has no device.keyid)")}
        </h3>
        <span translate="no" className={cx(MONO, "break-all text-[12.5px] text-[#5d646d]")}>
          {t("{name} · {n} files", { name: device.label, n: device.files })}
        </span>
      </div>

      {r?.hasDeviceKey ? (
        <p role="alert" className="rounded-md border border-[#e0b4b4] bg-[#fdf3f3] px-3 py-2 text-[14.5px] leading-relaxed text-[#8a1c1c]">
          {t("This folder holds device.key, the device's secret phrase. The page did not open it, and nothing was uploaded. Before you share this folder with anyone, remove device.key.")}
        </p>
      ) : null}

      {device.error ? (
        <p role="alert" className={cx("text-[14.5px]", INK.bad)}>
          {device.error}
        </p>
      ) : null}

      {r && r.kind === "error" ? (
        <p role="alert" className={cx("text-[14.5px]", INK.bad)}>
          {r.error === "no_chain"
            ? t("This folder has no usable chain.json, so there is no chain to check the signatures against. notebook.py verify stops here too.")
            : t("This log has {n} records. This page checks logs of up to {max} records; use notebook.py verify for a longer one.", { n: r.records, max: MAX_RECORDS })}
        </p>
      ) : null}

      {r && r.kind === "verdict" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span translate="no" className={cx("font-mono text-[18px] font-bold", r.valid ? INK.ok : INK.bad)}>
              {r.valid ? "VALID" : "INVALID"}
            </span>
            <Badge tone={r.valid ? "ok" : "bad"}>{r.valid ? t("the log checks out") : t("the log does not check out")}</Badge>
            <span className="text-[14px] text-[#3d434a]">{t("{n} records", { n: r.records })}</span>
          </div>
          {r.valid ? null : (
            <div>
              <p className="text-[14px] font-semibold">{t("Why:")}</p>
              <ul translate="no" className="mt-1 space-y-1 font-mono text-[12.5px] leading-relaxed">
                {r.problems.map((p, i) => (
                  <li key={i} className="break-all">
                    {problemLine(p)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <p className="text-[14px] font-semibold">{t("Permits")}</p>
            {r.permitsTooMany !== null ? (
              <p className={cx("text-[14px]", INK.bad)}>{t("This folder holds {n} permits. This page lists up to {max}.", { n: r.permitsTooMany, max: MAX_PERMITS })}</p>
            ) : states.length || foreign.length ? (
              <ul className="mt-1 space-y-1.5 text-[14px] leading-relaxed">
                {states.map((p) => (
                  <li key={p.permitId} className="break-words">
                    <span translate="no" className={cx(MONO, "text-[13px]")}>
                      {p.action}
                    </span>{" "}
                    <Badge tone={STATE_TONE[p.state]}>{{ used: t("used"), unused: t("unused"), expired: t("expired"), refused: t("cited, refused") }[p.state]}</Badge>{" "}
                    <span className="text-[#3d434a]">
                      {p.state === "used"
                        ? t("by record {seq}", { seq: p.by ?? "" })
                        : p.state === "unused"
                          ? t("records up to seq {exp} may cite it", { exp: String(p.expiresSeq) })
                          : p.state === "expired"
                            ? t("the log already has {n} records; it was open until seq {exp}", { n: r.records, exp: String(p.expiresSeq) })
                            : t("record {seq} cited it and was refused; notebook.py lets no later record cite it", { seq: p.by ?? "" })}
                    </span>
                    <span translate="no" className={cx(MONO, "block break-all text-[12px] text-[#5d646d]")}>
                      {p.permitId}
                    </span>
                  </li>
                ))}
                {foreign.map((p) => (
                  <li key={p.permitId} className="break-words">
                    <Badge tone="bad">{t("not a permit of this device")}</Badge>
                    <span translate="no" className={cx(MONO, "block break-all text-[12px] text-[#5d646d]")}>
                      {p.why}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-[#5d646d]">{t("No permits in this folder.")}</p>
            )}
            {!r.valid && states.length ? (
              <p className="mt-1 text-[13px] text-[#5d646d]">{t("This log is INVALID, so these states are read from records that did not all check out.")}</p>
            ) : null}
          </div>
          {props.onPermit ? (
            <Button kind="quiet" onClick={() => props.onPermit?.(device.label)}>
              {t("Give this device a one-time permit")}
            </Button>
          ) : null}
        </>
      ) : null}

      {r && r.kind === "verdict" ? <ShowsLists t={t} /> : null}
    </li>
  );
}

/** Give a one-time permit: the command to run on the device. Nothing is signed in the browser. */
export function PermitPanel(props: { t: T; folder: string; setFolder: (v: string) => void }) {
  const { t } = props;
  const [action, setAction] = useState("");
  const [seq, setSeq] = useState("");
  const [copied, setCopied] = useState(false);
  const typed = props.folder !== "" || action !== "" || seq !== "";
  const c = permitCommand({ dir: props.folder, action, expiresSeq: seq });
  return (
    <section aria-label={t("Give a one-time permit")} className="space-y-3 rounded-md border border-[#e3e5e8] px-4 py-4">
      <h2 className="text-[17px] font-bold">{t("Give a one-time permit")}</h2>
      <p className="text-[14.5px] leading-relaxed text-[#3d434a]">
        {t("This page signs nothing. A permit is signed on the device, with the device's own key, by the command below. One record may cite it once, up to the record number you give.")}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label={t("Folder on the device")} value={props.folder} onChange={(v) => props.setFolder(v)} mono placeholder="nb" />
        <Input label={t("Action")} value={action} onChange={setAction} mono placeholder="open-valve" />
        <Input label={t("Last record that may cite it")} value={seq} onChange={setSeq} mono placeholder="10" type="text" />
      </div>
      {c.ok ? (
        <div className="space-y-2">
          <p className="text-[14px]">{t("Run this on the device:")}</p>
          <pre translate="no" className={cx(MONO, "overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-[#f4f5f7] px-3 py-2 text-[13px]")}>
            {c.command}
          </pre>
          <Button
            kind="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(c.command).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? t("Copied") : t("Copy the command")}
          </Button>
          <p className="text-[13px] text-[#5d646d]">{t("It prints the new permit's id. A record cites it with: notebook.py record --permit <id>")}</p>
        </div>
      ) : typed ? (
        <p role="alert" translate="no" className={cx(MONO, "text-[13.5px]", INK.bad)}>
          {c.why}
        </p>
      ) : null}
    </section>
  );
}

function Page() {
  const { t } = useLang();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [folder, setFolder] = useState("");
  const [next, setNext] = useState(1);

  const tooMany = () => t("This folder holds more than {n} files. This page checks logs of up to {max} records; use notebook.py verify for a longer one.", { n: MAX_FILES, max: MAX_RECORDS });

  /** Check one folder in this tab. Read only when the check asks for a file; never device.key. */
  async function checkOne(files: Map<string, File>, label: string, key: number): Promise<Device> {
    const raw = [...files.keys()];
    const paths: string[] = notebookPaths(raw);
    const byPath = new Map(paths.map((p: string, i: number) => [p, files.get(raw[i]) as File]));
    try {
      const result = await checkMachineLog({ paths, read: async (p: string) => new Uint8Array(await (byPath.get(p) as File).arrayBuffer()), mldsa44Verify });
      return { key, label, files: files.size, result, error: "" };
    } catch (e: unknown) {
      return { key, label, files: files.size, result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function add(folders: { files: Map<string, File>; label: string; error?: string }[]) {
    setBusy(true);
    let k = next;
    const out: Device[] = [];
    for (const f of folders) {
      out.push(f.error ? { key: k, label: f.label, files: f.files.size, result: null, error: f.error } : await checkOne(f.files, f.label, k));
      k++;
    }
    setNext(k);
    setDevices((d) => [...d, ...out]);
    setBusy(false);
  }

  async function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
    // Each dropped folder is one device; loose files dropped together are one more.
    const folders: { files: Map<string, File>; label: string; error?: string }[] = [];
    const loose = new Map<string, File>();
    for (const en of entries) {
      if (en.isDirectory) {
        const files = new Map<string, File>();
        try {
          await walk(en, "", files);
          folders.push({ files, label: en.name });
        } catch (x: unknown) {
          folders.push({ files, label: en.name, error: x instanceof TooManyFiles ? tooMany() : t("The folder could not be read.") });
        }
      } else {
        try {
          await walk(en, "", loose);
        } catch {
          /* a single file that cannot be read is left out of the loose set */
        }
      }
    }
    if (loose.size) folders.push({ files: loose, label: t("dropped files") });
    if (folders.length) await add(folders);
  }

  function onPick(list: FileList | null) {
    if (!list || !list.length) return;
    const files = new Map<string, File>();
    for (const f of list) files.set(f.webkitRelativePath || f.name, f);
    const first = list[0].webkitRelativePath.split("/")[0];
    void add([{ files, label: first || t("chosen files") }]);
  }

  return (
    <div className="min-h-screen bg-white text-base text-[#1c1f23] [font-family:ui-sans-serif,system-ui,-apple-system,'Segoe_UI',Roboto,sans-serif]">
      <header className="border-b border-[#e3e5e8] px-4 py-3 md:px-6">
        <div className="mx-auto flex max-w-[52rem] flex-wrap items-center gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-bold">{t("Agent and machine control")}</h1>
            <StatusLine t={t} />
          </div>
          <LangSwitch />
        </div>
      </header>
      <main className="mx-auto max-w-[52rem] space-y-4 px-4 py-4 md:px-6">
        <p className="text-[15px] leading-relaxed text-[#3d434a]">
          {t("Drop the notebook folders of your devices, one folder per device. Each is checked here the way notebook.py verify checks it: which key signed its log, whether the log checks out, and what its one-time permits are.")}
        </p>
        <PinnedNotice
          lines={[
            t("Nothing is uploaded. The folders are read and checked in this tab; no file leaves your browser."),
            t("The page never opens device.key, the device's secret phrase."),
            t("The signatures are checked against the chain named in each folder's chain.json, as notebook.py verify does."),
            t("This page signs nothing. Permits are made on the device."),
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
          <p className="text-base font-semibold">{t("Drop one or more notebook folders here")}</p>
          <p className="mt-1 text-[14px] text-[#5d646d]">{t("The folder that holds records/, permits/ and chain.json.")}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <label className={cx(FOCUS, "inline-flex min-h-11 cursor-pointer items-center rounded-md bg-[#1a237e] px-4 text-[15px] font-semibold text-white focus-within:ring-2 focus-within:ring-[#1a237e] focus-within:ring-offset-2")}>
              {t("Choose a folder")}
              <input type="file" className="sr-only" multiple {...{ webkitdirectory: "" }} onChange={(e) => onPick(e.target.files)} />
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-[#c9ced4] bg-white px-4 text-[15px] focus-within:ring-2 focus-within:ring-[#1a237e] focus-within:ring-offset-2">
              {t("Choose its files")}
              <input type="file" className="sr-only" multiple onChange={(e) => onPick(e.target.files)} />
            </label>
          </div>
          <p className="mt-2 text-[13.5px] text-[#5d646d]">{t("On a phone, choose all the files of one folder (records and permits included); each choice adds one device.")}</p>
        </div>

        {busy ? <p className="text-[15px]">{t("Checking…")}</p> : null}

        {devices.length ? (
          <section aria-label={t("Devices")} aria-live="polite">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[17px] font-bold">{t("Devices ({n})", { n: devices.length })}</h2>
              <Button kind="quiet" onClick={() => setDevices([])}>
                {t("Clear the list")}
              </Button>
            </div>
            <ul>
              {devices.map((d) => (
                <DeviceCard key={d.key} device={d} t={t} onPermit={setFolder} />
              ))}
            </ul>
          </section>
        ) : null}

        <PermitPanel t={t} folder={folder} setFolder={setFolder} />
        <p className="text-[13.5px] text-[#5d646d]">{t("To make a log: tools/machine-notebook in the TET repository.")}</p>
      </main>
    </div>
  );
}

export default function AgentsControl(): ReactNode {
  return (
    <LangProvider>
      <Page />
    </LangProvider>
  );
}
