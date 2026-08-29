'use client';

import { signInWithGoogle, signInWithGithub, signInWithMicrosoft, signInWithApple } from '@/lib/actions/auth-actions';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  return (
    <div className="relative flex min-h-[calc(100svh-7rem)] items-center justify-center overflow-hidden px-4 py-10 md:min-h-screen">
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
          {/* Google */}
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 w-full rounded-full bg-background/70"
            onClick={signInWithGoogle}
          >
            <svg viewBox="0 0 24 24" className="mr-2 size-5">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </Button>

          {/* GitHub */}
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 w-full rounded-full bg-background/70"
            onClick={signInWithGithub}
          >
            <svg viewBox="0 0 24 24" className="mr-2 size-5" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            Continue with GitHub
          </Button>

          {/* Microsoft */}
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 w-full rounded-full bg-background/70"
            onClick={signInWithMicrosoft}
          >
            <svg viewBox="0 0 24 24" className="mr-2 size-5">
              <path d="M11.4 2H2v9.4h9.4V2z" fill="#F25022" />
              <path d="M22 2h-9.4v9.4H22V2z" fill="#7FBA00" />
              <path d="M11.4 12.6H2V22h9.4v-9.4z" fill="#00A4EF" />
              <path d="M22 12.6h-9.4V22H22v-9.4z" fill="#FFB900" />
            </svg>
            Continue with Microsoft
          </Button>

          {/* Apple */}
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 w-full rounded-full bg-background/70"
            onClick={signInWithApple}
          >
            <svg viewBox="0 0 24 24" className="mr-2 size-5" fill="currentColor">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
            </svg>
            Continue with Apple
          </Button>
        </div>
      </div>
    </div>
  );
}
