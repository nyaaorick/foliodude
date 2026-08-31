import { Page, PageHeader } from '@/components/app/page-state';

export default function ContactUsPage() {
  return (
    <Page>
      <PageHeader title="Contact us" />
      <div className="space-y-3 rounded-2xl border border-border/60 bg-card/80 p-4 text-sm text-muted-foreground md:p-6">
        <p>This project is open-source and available on GitHub.</p>
        <p>
          Your financial data is stored <strong>locally on your device</strong> using an
          in-browser database. It never leaves your device unless you explicitly enable cloud
          sync. You are safe to enter real account information.
        </p>
        <p>
          FolioDude was built for people whose finances are spread across multiple countries,
          stocks, airline miles, and credit card rewards — making it hard to get a clear picture
          in one place. Feedback and contributions are welcome.
        </p>
        <p className="flex flex-wrap gap-4">
          <a
            href="https://github.com/nyaaorick/foliodude"
            className="font-medium text-foreground underline underline-offset-4"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <a
            href="https://discord.gg/BqC4JzwT"
            className="font-medium text-foreground underline underline-offset-4"
            target="_blank"
            rel="noreferrer"
          >
            Discord
          </a>
        </p>
      </div>
    </Page>
  );
}
