export default function AccountsPage() {
  // TODO Phase 2: Wire getAccounts() + getRewardRates() via PGLite
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-[2rem] border border-border/80 bg-card/90 px-6 py-6 shadow-[0_12px_40px_rgba(48,33,22,0.08)] backdrop-blur sm:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <span className="inline-flex w-fit rounded-full border border-border/80 bg-accent/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Account Overview
            </span>
            <div className="space-y-2">
              <h1 className="text-4xl leading-none font-medium tracking-tight [font-family:var(--font-display)] sm:text-5xl">
                Accounts
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Track cash, cards, airline miles, and investments in one warm ledger.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-[1.8rem] border border-border/50 bg-card/60 p-8 text-center text-sm text-muted-foreground">
        Account list will be available after PGLite integration (Phase 2).
      </div>
    </div>
  );
}
