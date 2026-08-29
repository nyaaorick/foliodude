export function AppShellSkeleton() {
  return (
    <div className="pointer-events-none min-h-screen">
      <aside className="fixed inset-y-6 left-6 z-30 hidden w-40 flex-col rounded-[1.9rem] border border-sidebar-border/60 bg-sidebar/70 p-3 shadow-[0_18px_45px_rgba(48,33,22,0.08)] backdrop-blur md:flex">
        <div className="space-y-6">
          <div className="h-10 rounded-[1.45rem] border border-sidebar-border/50 bg-background/40" />
          <div className="space-y-2">
            <div className="h-9 rounded-[1.1rem] bg-sidebar-accent/50" />
            <div className="h-9 rounded-[1.1rem] bg-sidebar-accent/40" />
            <div className="h-9 rounded-[1.1rem] bg-sidebar-accent/30" />
            <div className="h-9 rounded-[1.1rem] bg-sidebar-accent/20" />
          </div>
        </div>
        <div className="mt-4 h-3 w-24 rounded bg-sidebar-accent/30" />
      </aside>

      <div className="fixed inset-x-4 top-4 z-30 md:hidden">
        <div className="rounded-[1.7rem] border border-sidebar-border/60 bg-sidebar/80 p-2 shadow-[0_14px_36px_rgba(48,33,22,0.08)] backdrop-blur">
          <div className="mb-2 h-4 w-24 rounded bg-sidebar-accent/30" />
          <div className="flex gap-2 overflow-hidden">
            <div className="h-9 w-20 rounded-[1.1rem] bg-sidebar-accent/40" />
            <div className="h-9 w-20 rounded-[1.1rem] bg-sidebar-accent/30" />
            <div className="h-9 w-20 rounded-[1.1rem] bg-sidebar-accent/20" />
          </div>
        </div>
      </div>
    </div>
  );
}
