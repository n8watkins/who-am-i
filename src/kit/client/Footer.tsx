// Party kit: the small footer every game shows, with a "What's new" link to its changelog and the
// running version. Games can add their own items (a theme switch, links) as children.
import type { ReactNode } from "react";

export function KitFooter({ version, changelogUrl, children }: { version: string; changelogUrl: string; children?: ReactNode }) {
  return (
    <footer className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 pt-2 pb-[calc(1.25rem+var(--action-bar-h,0px))] text-sm font-semibold text-muted sm:px-6 sm:pb-6">
      <a
        href={changelogUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 hover:text-brand-ink"
        data-testid="whats-new"
      >
        What's new <span aria-hidden="true">·</span> <span className="tabular-nums">v{version}</span>
      </a>
      {children}
    </footer>
  );
}
