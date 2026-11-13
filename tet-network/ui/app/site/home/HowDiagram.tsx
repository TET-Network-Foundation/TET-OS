"use client";
/**
 * The home page's "How it works" diagram: five blocks, key → one-time permission → machine signs →
 * existed before block N → anyone checks, joined by lines that draw downward as the visitor scrolls.
 *
 * Motion: an IntersectionObserver hides a block only while it is below the viewport, then shows it
 * (and draws its link from the block above) once a quarter of it is on screen. Nothing is hidden
 * before the script runs, so without JavaScript the finished diagram is what renders. With
 * prefers-reduced-motion the observer is never started, and the motion-reduce: classes keep every
 * block and link in its finished state even if it had been hidden. No network request, no words in
 * the drawings: every word goes through t().
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSite } from "../i18n";

const cx = (...p: Array<string | false | null | undefined>) => p.filter(Boolean).join(" ");

/** Icon strokes: teal, and slate for the parts that are only context. */
const LINE = "fill-none stroke-teal-700 dark:stroke-teal-300";
const SOFT = "fill-none stroke-slate-400 dark:stroke-slate-500";
const FILL = "fill-teal-700 dark:fill-teal-300";

function Icon(props: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-12 w-12 shrink-0" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      {props.children}
    </svg>
  );
}

const KEY = (
  <Icon>
    <circle className={LINE} cx="14" cy="24" r="8" />
    <path className={LINE} d="M22 24 H42 M36 24 V31 M42 24 V29" />
  </Icon>
);
const PERMIT = (
  <Icon>
    <path className={LINE} d="M6 12 H42 V20 a4 4 0 0 0 0 8 V36 H6 V28 a4 4 0 0 0 0 -8 Z" />
    <circle className={FILL} cx="24" cy="24" r="4" />
  </Icon>
);
const SIGNS = (
  <Icon>
    <rect className={LINE} x="6" y="10" width="22" height="18" rx="4" />
    <circle className={FILL} cx="13" cy="19" r="2" />
    <circle className={FILL} cx="21" cy="19" r="2" />
    <path className={LINE} d="M12 28 V34 M22 28 V34" />
    <path className={LINE} d="M26 38 c4 -6 6 6 10 0 s6 -6 8 0" />
  </Icon>
);
const BLOCK = (
  <Icon>
    <rect className={SOFT} x="2" y="18" width="12" height="12" rx="2" />
    <rect className={LINE} x="18" y="16" width="16" height="16" rx="3" />
    <rect className={SOFT} x="38" y="18" width="8" height="12" rx="2" />
    <path className={SOFT} d="M14 24 H18 M34 24 H38" />
    <path className={LINE} d="M26 4 V12 M22 9 L26 13 L30 9" />
  </Icon>
);
const CHECK = (
  <Icon>
    <circle className={LINE} cx="20" cy="20" r="12" />
    <path className={LINE} d="M29 29 L42 42" />
    <path className={LINE} d="M14 20 L18 24 L26 16" />
  </Icon>
);

const STEPS = [
  { icon: KEY, title: "A key", text: "A machine or an agent holds its own key. The key stays on that device." },
  { icon: PERMIT, title: "A one-time permission", text: "The key's owner signs a permission for one named action. It can be used once." },
  { icon: SIGNS, title: "The machine signs", text: "The machine signs a record of what it did, with both signatures, and uses up the permission." },
  { icon: BLOCK, title: "Existed before block N", text: "A fingerprint of the record goes into block N. That shows the record existed before that block." },
  { icon: CHECK, title: "Anyone checks", text: "Anyone holding the record can check the signatures, the permission and the block. A second use of the same permission is refused." },
];

export function HowDiagram() {
  const { t } = useSite();
  const refs = useRef<Array<HTMLLIElement | null>>([]);
  const [hidden, setHidden] = useState<boolean[]>(() => STEPS.map(() => false));

  useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const shown = new Set<number>();
    const io = new IntersectionObserver(
      (entries) => {
        const change = new Map<number, boolean>();
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.step);
          if (e.isIntersecting) {
            shown.add(i);
            change.set(i, false);
            io.unobserve(e.target);
          } else if (!shown.has(i) && e.boundingClientRect.top > 0) {
            change.set(i, true); // below the viewport and not yet seen: wait for it
          }
        }
        if (!change.size) return;
        setHidden((prev) => {
          const next = prev.map((v, i) => change.get(i) ?? v);
          return next.every((v, i) => v === prev[i]) ? prev : next;
        });
      },
      { threshold: 0.25 },
    );
    for (const el of refs.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <figure className="flex flex-col gap-4">
      <ol className="flex flex-col">
        {STEPS.map((s, i) => (
          <li key={s.title} ref={(el) => void (refs.current[i] = el)} data-step={i} className="flex flex-col">
            {i > 0 ? (
              <div aria-hidden="true" className="flex h-12 w-12 justify-center">
                <span
                  className={cx(
                    "block h-full w-1 origin-top rounded-full bg-teal-700 dark:bg-teal-300",
                    "motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out",
                    hidden[i] ? "scale-y-0 motion-reduce:scale-y-100" : "scale-y-100",
                  )}
                />
              </div>
            ) : null}
            <div
              className={cx(
                "flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900",
                "motion-safe:transition motion-safe:delay-300 motion-safe:duration-500 motion-safe:ease-out",
                hidden[i] ? "translate-y-4 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100" : "translate-y-0 opacity-100",
              )}
            >
              {s.icon}
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold">{t(s.title)}</h3>
                <p className="max-w-prose text-sm leading-relaxed text-slate-700 dark:text-slate-300">{t(s.text)}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <figcaption className="max-w-prose text-sm leading-relaxed text-slate-600 dark:text-slate-400">
        {t("A check shows which key signed, under which permission, and that the record existed before block N. It does not show that what the machine did was right. In the prototypes, every step runs on your own computer.")}
      </figcaption>
    </figure>
  );
}
