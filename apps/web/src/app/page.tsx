"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  CONTENT_LAST_CHECKED,
  HOUSING_LINKS,
  SCOPE_ITEMS,
  SOURCE_ORGANISATIONS,
} from "@/lib/content";
import { track } from "@/lib/analytics";

export default function Landing() {
  useEffect(() => {
    track("landing_view", { referrer: document.referrer || null });
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12 sm:px-8">
        <header className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Image
              src="/logo/una-wordmark.webp"
              alt="Una"
              width={100}
              height={31}
              priority
            />
            <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              una for uni
            </span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Everything you need to do before and after you land, in one place.
          </h1>
          <p className="text-base text-zinc-600 dark:text-zinc-400">
            One personalised, source-cited checklist for your permit, money,
            and health coverage — from accepting your offer to your first 30
            days in Vancouver. No more piecing it together across four
            different websites.
          </p>
        </header>

        <section
          aria-label="What this covers"
          className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
        >
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            What&apos;s in your checklist
          </h2>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {SCOPE_ITEMS.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2 text-sm text-zinc-800 dark:text-zinc-200"
              >
                <span aria-hidden className="mt-1 text-brand-hover dark:text-brand">
                  •
                </span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-label="Housing"
          className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/30"
        >
          <h2 className="text-sm font-medium text-amber-900 dark:text-amber-200">
            We don&apos;t cover housing
          </h2>
          <p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
            We know it&apos;s one of the hardest parts of the move, but we
            don&apos;t have verified sources for it yet. Two starting points
            we have no affiliation with:
          </p>
          <ul className="mt-3 flex flex-col gap-1">
            {HOUSING_LINKS.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-amber-900 underline underline-offset-2 dark:text-amber-200"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Choose your program level" className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Which best describes you?
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              href="/intake?level=graduate"
              onClick={() => track("level_selected", { level: "graduate" })}
              className="rounded-xl border border-brand bg-brand px-6 py-5 text-center text-base font-semibold text-brand-foreground transition hover:bg-brand-hover hover:border-brand-hover"
            >
              Graduate student
            </Link>
            <Link
              href="/intake?level=undergraduate"
              onClick={() => track("level_selected", { level: "undergraduate" })}
              className="rounded-xl border border-zinc-300 px-6 py-5 text-center text-base font-semibold text-zinc-900 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              Undergraduate student
            </Link>
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <p>
            Sources: {SOURCE_ORGANISATIONS.join(", ")} — last checked{" "}
            {CONTENT_LAST_CHECKED}.
          </p>
          <p>
            This is general information, not immigration or financial advice,
            and is not a guarantee of any outcome including permit approval.
          </p>
        </footer>
      </main>
    </div>
  );
}
