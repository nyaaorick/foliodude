export default function LabPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6">
        <p className="text-[0.72rem] font-medium uppercase tracking-[0.24em] text-muted-foreground">
          Lab
        </p>
        <h1 className="mt-2 text-3xl font-medium tracking-tight [font-family:var(--font-display)]">
          Lab
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Lab is for features under test. Feedback is always welcome.
        </p>
      </div>
      <div className="rounded-[1.8rem] border border-border/50 bg-card/60 p-8 text-center text-sm text-muted-foreground">
        Lab features will be available after PGLite integration (Phase 2).
      </div>
    </div>
  );
}
