import {
  AUTH_PROVIDERS,
  AUTH_PROVIDER_LABELS,
  isAuthEnabled,
  signInWithProvider,
} from '@/lib/auth';

export default function LoginPage() {
  return (
    <div className="relative flex min-h-[calc(100svh-7rem)] items-center justify-center overflow-hidden px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(214,138,94,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(161,128,94,0.12),transparent_24%)]" />
      <div className="relative w-full max-w-md space-y-8 rounded-[2rem] border border-border/80 bg-card/95 p-8 shadow-[0_20px_60px_rgba(48,33,22,0.12)] backdrop-blur">
        <div className="space-y-3 text-center">
          <span className="inline-flex rounded-full border border-border/80 bg-accent/60 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            FolioDude
          </span>
          <h1 className="text-4xl leading-none font-medium tracking-tight [font-family:var(--font-display)]">
            Sign in
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Your financial data is stored locally on this device. Sign in to enable cloud sync.
          </p>
        </div>

        <div className="space-y-3">
          {AUTH_PROVIDERS.map((provider) => (
            <button
              key={provider}
              type="button"
              disabled={!isAuthEnabled}
              onClick={() => void signInWithProvider(provider)}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border bg-background/70 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              Continue with {AUTH_PROVIDER_LABELS[provider]}
            </button>
          ))}
        </div>

        {!isAuthEnabled && (
          <p className="text-center text-xs leading-5 text-muted-foreground">
            Cloud sync arrives in a later release. Everything works offline in the meantime.
          </p>
        )}
      </div>
    </div>
  );
}
