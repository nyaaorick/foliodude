import { useParams } from 'react-router-dom';

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();

  // TODO Phase 2: Wire loadAccountDetailCore(id) via PGLite
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="rounded-[1.8rem] border border-border/50 bg-card/60 p-8 text-center text-sm text-muted-foreground">
        Account detail for <code className="font-mono text-xs">{id}</code> will be available after PGLite integration (Phase 2).
      </div>
    </div>
  );
}
