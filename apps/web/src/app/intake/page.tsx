import Link from "next/link";

// Stub target for the Landing screen's program-level buttons. The real
// Intake screen (citizenship combobox, arrival-date picker) is Week 2
// client work — see docs/implementation-plan.md.
export default function IntakePlaceholder() {
  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-12 sm:px-8">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Intake screen coming next
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This is where you&apos;d tell us your citizenship and arrival date.
          Not built yet — part of the Week 2 client work.
        </p>
        <Link
          href="/"
          className="text-sm font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
        >
          Back to landing
        </Link>
      </main>
    </div>
  );
}
