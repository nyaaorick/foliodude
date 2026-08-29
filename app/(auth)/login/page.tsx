import { signInWithGoogle } from '@/lib/actions/auth-actions';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  return (
    <div className="relative flex min-h-[calc(100svh-7rem)] items-center justify-center overflow-hidden px-4 py-10 md:min-h-screen">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(214,138,94,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(161,128,94,0.12),transparent_24%)]" />
      <div className="relative w-full max-w-md space-y-8 rounded-[2rem] border border-border/80 bg-card/95 p-8 shadow-[0_20px_60px_rgba(48,33,22,0.12)] backdrop-blur">
        <div className="space-y-3 text-center">
          <span className="inline-flex rounded-full border border-border/80 bg-accent/60 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            FolioDude.it.com
          </span>
          <h1 className="text-4xl leading-none font-medium tracking-tight [font-family:var(--font-display)]">
            Account
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Manage your Google sign-in for this finance dashboard.
          </p>
        </div>
        <form action={signInWithGoogle}>
          <Button
            type="submit"
            variant="outline"
            size="lg"
            className="h-11 w-full rounded-full bg-background/70"
          >
            <svg viewBox="0 0 24 24" className="mr-2 size-5">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Sign in with Google
          </Button>
        </form>
      </div>
    </div>
  );
}
