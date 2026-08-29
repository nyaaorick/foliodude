export default function ContactUsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="rounded-3xl border border-border/60 bg-card/80 p-6 shadow-[0_12px_30px_rgba(48,33,22,0.08)]">
        <h1 className="text-2xl font-semibold tracking-tight">Contact us</h1>
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <p>This project is open-source and available on GitHub.</p>
          <p>
            Your financial data is stored <strong>locally on your device</strong> using an
            in-browser database. It never leaves your device unless you explicitly enable
            cloud sync. You are safe to enter real account information.
          </p>
          <p>
            FolioDude was built for people whose finances are spread across multiple
            countries, stocks, airline miles, and credit card rewards - making it
            hard to get a clear picture in one place. Feedback and contributions are
            welcome.
          </p>
          <p>
            <a
              href="https://github.com/nyaaorick/finproject"
              className="font-medium text-foreground underline-offset-4 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </p>
          <p>
            <a
              href="https://discord.gg/BqC4JzwT"
              className="font-medium text-foreground underline-offset-4 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Join the Discord
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
