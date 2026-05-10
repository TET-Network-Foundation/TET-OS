"use client";

import { useT } from "../i18n/useT";

export default function Participate() {
  const { t } = useT();
  return (
    <main>
      <section className="bg-white text-slate-900">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-12 px-6 py-12">
          {/* Sidebar */}
          <aside className="hidden md:block sticky top-32 h-fit self-start w-full md:w-64 shrink-0">
            <div>
              <div className="font-mono text-xs uppercase tracking-widest text-slate-500 mb-4">{t("docs.onThisPage")}</div>
              <nav className="space-y-2 text-sm">
                {[
                  { href: "#grid", label: t("docs.navGrid") },
                  { href: "#workers", label: t("docs.navWorkers") },
                  { href: "#builders", label: t("docs.navBuilders") },
                ].map((it) => (
                  <a
                    key={it.href}
                    href={it.href}
                    className="block rounded-md px-2 py-1 text-slate-500 hover:text-indigo-600 hover:font-semibold transition"
                  >
                    {it.label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Main content */}
          <div className="flex-1">
            <article className="prose prose-slate max-w-4xl leading-relaxed text-slate-700">
              <h1>{t("participate.title")}</h1>
              <p className="lead">{t("participate.sub")}</p>

              <section id="grid" className="mt-20 pt-10 border-t border-slate-200">
                <h2 className="text-3xl font-bold tracking-tight text-slate-900 mb-6">{t("docs.navGrid")}</h2>
                <div className="space-y-6">
                  <p>{t("docs.manual.gridP1")}</p>
                </div>
              </section>

              <section id="workers" className="mt-20 pt-10 border-t border-slate-200">
                <h2 className="text-3xl font-bold tracking-tight text-slate-900 mb-6">{t("docs.navWorkers")}</h2>
                <div className="space-y-6">
                  <p>{t("docs.manual.workersP1")}</p>
                </div>

                <h3 className="text-xl font-semibold text-slate-900 mt-10">{t("docs.manual.workersPrereqTitle")}</h3>
                <p className="mt-4">{t("docs.manual.workersPrereqBody")}</p>

                <h3 className="text-xl font-semibold text-slate-900 mt-10">{t("docs.manual.workersRunTitle")}</h3>
                <p className="mt-4">{t("docs.manual.workersRunBody")}</p>
                <pre className="not-prose bg-slate-900 text-slate-50 p-4 rounded-xl overflow-x-auto font-mono text-sm shadow-sm mt-4 mb-8">
                  <code>$ ollama serve</code>
                </pre>

                <h3 className="text-xl font-semibold text-slate-900 mt-10">{t("docs.manual.workersConnectTitle")}</h3>
                <p className="mt-4">{t("docs.manual.workersConnectBody")}</p>
              </section>

              <section id="builders" className="mt-20 pt-10 border-t border-slate-200">
                <h2 className="text-3xl font-bold tracking-tight text-slate-900 mb-6">{t("docs.navBuilders")}</h2>
                <div className="space-y-6">
                  <p>{t("docs.manual.buildersP1")}</p>
                </div>

                <h3 className="text-xl font-semibold text-slate-900 mt-10">{t("docs.manual.buildersStep1Title")}</h3>
                <p className="mt-4">{t("docs.manual.buildersStep1Body")}</p>
                <pre className="not-prose bg-slate-900 text-slate-50 p-4 rounded-xl overflow-x-auto font-mono text-sm shadow-sm mt-4 mb-8">
                  <code>
                    <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold font-mono mr-2">GET</span>
                    <span>/ai/nonce?wallet_id=&lt;hex&gt;</span>
                  </code>
                </pre>

                <h3 className="text-xl font-semibold text-slate-900 mt-10">{t("docs.manual.buildersStep2Title")}</h3>
                <p className="mt-4">{t("docs.manual.buildersStep2Body")}</p>
                <pre className="not-prose bg-slate-900 text-slate-50 p-4 rounded-xl overflow-x-auto font-mono text-sm shadow-sm mt-4 mb-8">
                  <code>{"message = prompt + nonce\ned25519_sig_b64 = base64(ed25519_sign(message))"}</code>
                </pre>

                <h3 className="text-xl font-semibold text-slate-900 mt-10">{t("docs.manual.buildersStep3Title")}</h3>
                <p className="mt-4">{t("docs.manual.buildersStep3Body")}</p>
                <pre className="not-prose bg-slate-900 text-slate-50 p-4 rounded-xl overflow-x-auto font-mono text-sm shadow-sm mt-4 mb-8">
                  <code>
                    <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold font-mono mr-2">POST</span>
                    <span>/ai/infer_signed</span>
                    {"\n"}
                    {`{ wallet_id, prompt, nonce, ed25519_sig_b64 }`}
                  </code>
                </pre>
              </section>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}

