"use client";

import { useT } from "../i18n/useT";

export default function UnderstandTET() {
  const { t } = useT();
  return (
    <main>
      <section className="bg-white text-slate-900">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-12 px-6 py-12">
          {/* Sidebar */}
          <aside className="hidden md:block sticky top-32 h-fit self-start w-full md:w-64 shrink-0">
            <div>
              <div className="font-mono text-xs uppercase tracking-widest text-slate-500 mb-4">{t("understand.onThisPage")}</div>
              <nav className="space-y-2 text-sm">
                {[
                  { href: "#basics", label: t("understand.navBasics") },
                  { href: "#authorization", label: t("understand.navAuthorization") },
                  { href: "#processing", label: t("understand.navProcessing") },
                  { href: "#consensus", label: t("understand.navConsensus") },
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

          {/* Main */}
          <article className="prose prose-slate max-w-4xl flex-1 leading-relaxed text-slate-700">
            <h1>{t("understand.title")}</h1>
            <p className="lead">{t("understand.sub")}</p>

            <section className="mt-10 mb-16 rounded-2xl bg-slate-50 p-6">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 mb-4">{t("understand.tldrTitle")}</h2>
              <div className="space-y-4 text-lg text-slate-600 leading-relaxed">
                <p>{t("understand.tldrP1")}</p>
                <p>{t("understand.tldrP2")}</p>
                <p>{t("understand.tldrP3")}</p>
              </div>
            </section>

            <section id="basics" className="mt-20 pt-10 border-t border-slate-200">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 mb-6">{t("understand.prose.basicsTitle")}</h2>
              <div className="space-y-6">
                <p>{t("understand.prose.basicsBody1")}</p>
                <p>{t("understand.prose.basicsBody2")}</p>
              </div>
            </section>

            <section id="authorization" className="mt-20 pt-10 border-t border-slate-200">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 mb-6">{t("understand.prose.authTitle")}</h2>
              <div className="space-y-6">
                <p>{t("understand.prose.authBody1")}</p>
                <p>{t("understand.prose.authBody2")}</p>
              </div>
            </section>

            <section id="processing" className="mt-20 pt-10 border-t border-slate-200">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 mb-6">{t("understand.prose.procTitle")}</h2>
              <div className="space-y-6">
                <p>{t("understand.prose.procBody1")}</p>
                <p>{t("understand.prose.procBody2")}</p>
              </div>
            </section>

            <section id="consensus" className="mt-20 pt-10 border-t border-slate-200">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 mb-6">{t("understand.prose.consTitle")}</h2>
              <div className="space-y-6">
                <p>{t("understand.prose.consBody1")}</p>
                <p>{t("understand.prose.consBody2")}</p>
              </div>
            </section>

            <section className="mt-20 pt-10 border-t border-slate-200">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 mb-6">{t("understand.ctaTitle")}</h2>
              <div className="space-y-6">
                <p>{t("understand.ctaBody")}</p>
                <div className="not-prose flex flex-wrap gap-3">
                  <a
                    href="/participate"
                    className="inline-flex items-center justify-center rounded-md bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition"
                  >
                    {t("understand.ctaParticipate")}
                  </a>
                  <a
                    href={t("understand.ctaGithubUrl")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                  >
                    {t("understand.ctaGithub")}
                  </a>
                </div>
              </div>
            </section>
          </article>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-16">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-8">
              <h2 className="text-3xl font-bold tracking-tight text-slate-900">{t("understand.nextTitle")}</h2>
              <p className="mt-3 text-base leading-relaxed text-slate-600">
                {t("understand.nextBody")}
              </p>
            </div>
            <div className="lg:col-span-4 lg:flex lg:justify-end">
              <a
                href="/os"
                className="inline-flex w-full items-center justify-center rounded-md bg-yellow-400 px-6 py-3 text-sm font-bold text-black hover:bg-yellow-300 transition lg:w-auto"
              >
                {t("understand.nextCta")}
              </a>
            </div>
          </div>
          <div className="mt-8 text-xs text-slate-500">
            {t("understand.nextTip")}
          </div>
        </div>
      </section>
    </main>
  );
}

