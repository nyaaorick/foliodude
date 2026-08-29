'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface InlineValuationEditorProps {
  title: string;
  subtitle?: string;
  quantityLabel?: string;
  rate: number;
  rateLabel: string;
  estimateLabel?: string | null;
  compact?: boolean;
  onSave: (nextRate: number) => Promise<{ success: boolean; error?: string }>;
}

export function InlineValuationEditor({
  title,
  subtitle,
  quantityLabel,
  rate,
  rateLabel,
  estimateLabel,
  compact = false,
  onSave,
}: InlineValuationEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draftRate, setDraftRate] = useState(String(rate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const rowClassName = compact
    ? 'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5'
    : 'flex items-center justify-between gap-3 rounded-md border px-3 py-2';
  const titleClassName = compact ? 'text-xs font-medium' : 'text-sm font-medium';

  const startEdit = () => {
    setError('');
    setDraftRate(String(rate));
    setEditing(true);
  };

  const handleBlur = async () => {
    const nextRate = Number.parseInt(draftRate.trim() || '0', 10);
    if (!Number.isFinite(nextRate) || Number.isNaN(nextRate) || nextRate < 0) {
      setError('Rate must be a non-negative integer');
      return;
    }

    if (nextRate === rate) {
      setEditing(false);
      setError('');
      return;
    }

    setSaving(true);
    setError('');
    const result = await onSave(nextRate);
    setSaving(false);

    if (!result.success) {
      setError(result.error ?? 'Failed to save rate');
      return;
    }

    setEditing(false);
  };

  return (
    <div className="space-y-2">
      <div className={rowClassName}>
        <div className="min-w-0">
          <p className={titleClassName}>{title}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
          {quantityLabel && (
            <p className="text-xs text-muted-foreground">{quantityLabel}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {editing ? (
            <>
              <span className="text-xs text-muted-foreground">{rateLabel}</span>
              <Input
                autoFocus
                type="number"
                min="0"
                step="1"
                className="h-7 w-20 text-xs"
                value={draftRate}
                onChange={(event) => setDraftRate(event.target.value)}
                onBlur={() => void handleBlur()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    (event.currentTarget as HTMLInputElement).blur();
                  }
                }}
                onClick={(event) => {
                  event.stopPropagation();
                }}
              />
              <span className="text-xs text-muted-foreground">USD</span>
              {saving && (
                <span className="text-xs text-muted-foreground">Saving...</span>
              )}
            </>
          ) : (
            <>
              {estimateLabel && (
                <span className="text-xs text-muted-foreground">
                  {estimateLabel}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  startEdit();
                }}
              >
                <Pencil className="size-3.5 text-muted-foreground" />
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

