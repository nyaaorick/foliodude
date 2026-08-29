'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { updateRewardRule } from '@/lib/actions/reward-actions';
import type {
  RewardCapPeriod,
  RewardCurrencyId,
  RewardRule,
} from '@/lib/types/rewards';
import {
  getRewardCurrencyColor,
  getRewardCurrencyLabel,
} from '@/lib/utils/display-labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type EditingField = 'basic-rate' | 'cap' | 'multiplier' | null;

interface RewardRuleInlineRowProps {
  accountId: string;
  rewardCurrency: RewardCurrencyId | null;
  rule: RewardRule;
}

function formatRuleNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatCapAmount(value: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCapPeriodShort(period: RewardCapPeriod) {
  return period === 'monthly' ? 'mon' : 'annual';
}

function getRewardBadgeStyle(color: string) {
  return {
    borderColor: color,
    backgroundColor: `${color}1A`,
    color,
  };
}

export function RewardRuleInlineRow({
  accountId,
  rewardCurrency,
  rule: initialRule,
}: RewardRuleInlineRowProps) {
  const router = useRouter();
  const [rule, setRule] = useState(initialRule);
  const [editingField, setEditingField] = useState<EditingField>(null);
  const [savingField, setSavingField] = useState<EditingField>(null);
  const [error, setError] = useState('');
  const [draftMultiplier, setDraftMultiplier] = useState(
    String(initialRule.multiplier),
  );
  const [draftCapAmount, setDraftCapAmount] = useState(
    initialRule.cap_amount != null ? String(initialRule.cap_amount) : '',
  );
  const [draftCapPeriod, setDraftCapPeriod] = useState<RewardCapPeriod>(
    initialRule.cap_period ?? 'annual',
  );
  const [draftBasicRate, setDraftBasicRate] = useState(
    String(initialRule.fallback_rate ?? 1),
  );

  const startEdit = (field: Exclude<EditingField, null>) => {
    setError('');
    setEditingField(field);

    if (field === 'multiplier') {
      setDraftMultiplier(String(rule.multiplier));
      return;
    }

    if (field === 'cap') {
      setDraftCapAmount(rule.cap_amount != null ? String(rule.cap_amount) : '');
      setDraftCapPeriod(rule.cap_period ?? 'annual');
      return;
    }

    setDraftBasicRate(String(rule.fallback_rate ?? 1));
  };

  const persistRule = async (
    field: Exclude<EditingField, null>,
    nextValues: {
      cap_amount?: number | undefined;
      cap_period?: RewardCapPeriod | undefined;
      fallback_rate?: number | undefined;
      multiplier?: number;
    },
  ) => {
    setSavingField(field);
    setError('');

    try {
      const nextRule = await updateRewardRule({
        accountId,
        category: rule.category,
        multiplier:
          'multiplier' in nextValues && nextValues.multiplier !== undefined
            ? nextValues.multiplier
            : rule.multiplier,
        cap_amount:
          'cap_amount' in nextValues ? nextValues.cap_amount : rule.cap_amount,
        cap_period:
          'cap_period' in nextValues ? nextValues.cap_period : rule.cap_period,
        fallback_rate:
          'fallback_rate' in nextValues
            ? nextValues.fallback_rate
            : rule.fallback_rate,
      });

      setRule(nextRule);
      setDraftMultiplier(String(nextRule.multiplier));
      setDraftCapAmount(
        nextRule.cap_amount != null ? String(nextRule.cap_amount) : '',
      );
      setDraftCapPeriod(nextRule.cap_period ?? 'annual');
      setDraftBasicRate(String(nextRule.fallback_rate ?? 1));
      setEditingField(null);
      router.refresh();
    } catch (caughtError) {
      if (!(caughtError instanceof Error)) {
        throw caughtError;
      }

      setError(caughtError.message);
    } finally {
      setSavingField(null);
    }
  };

  const saveMultiplier = async () => {
    const nextMultiplier = Number.parseFloat(draftMultiplier.trim() || '0');
    if (!Number.isFinite(nextMultiplier) || Number.isNaN(nextMultiplier) || nextMultiplier < 0) {
      setError('Multiplier must be a non-negative number');
      return;
    }

    if (nextMultiplier === rule.multiplier) {
      setEditingField(null);
      setError('');
      return;
    }

    await persistRule('multiplier', { multiplier: nextMultiplier });
  };

  const saveCap = async () => {
    const normalizedAmount = draftCapAmount.trim();

    if (normalizedAmount.length === 0) {
      if (rule.cap_amount == null && rule.cap_period == null) {
        setEditingField(null);
        setError('');
        return;
      }

      await persistRule('cap', {
        cap_amount: undefined,
        cap_period: undefined,
      });
      return;
    }

    const nextCapAmount = Number.parseFloat(normalizedAmount);
    if (!Number.isFinite(nextCapAmount) || Number.isNaN(nextCapAmount) || nextCapAmount < 0) {
      setError('Cap must be a non-negative number');
      return;
    }

    if (
      nextCapAmount === rule.cap_amount &&
      draftCapPeriod === (rule.cap_period ?? 'annual')
    ) {
      setEditingField(null);
      setError('');
      return;
    }

    await persistRule('cap', {
      cap_amount: nextCapAmount,
      cap_period: draftCapPeriod,
    });
  };

  const saveBasicRate = async () => {
    const nextBasicRate = Number.parseFloat(draftBasicRate.trim() || '0');
    if (!Number.isFinite(nextBasicRate) || Number.isNaN(nextBasicRate) || nextBasicRate < 0) {
      setError('Basic reward rate must be a non-negative number');
      return;
    }

    if (nextBasicRate === (rule.fallback_rate ?? 1)) {
      setEditingField(null);
      setError('');
      return;
    }

    await persistRule('basic-rate', { fallback_rate: nextBasicRate });
  };

  const renderMultiplier = () =>
    editingField === 'multiplier' ? (
      <Input
        autoFocus
        type="number"
        min="0"
        step="any"
        className="h-7 w-20 text-xs"
        value={draftMultiplier}
        disabled={savingField !== null}
        onChange={(event) => setDraftMultiplier(event.target.value)}
        onBlur={() => void saveMultiplier()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void saveMultiplier();
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            setEditingField(null);
            setError('');
          }
        }}
      />
    ) : (
      <div className="flex items-center gap-1">
        <span>{formatRuleNumber(rule.multiplier)}x</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5 rounded-full text-muted-foreground hover:text-foreground"
          disabled={savingField !== null}
          aria-label={`Edit multiplier for ${rule.category}`}
          onClick={() => startEdit('multiplier')}
        >
          <Pencil className="size-3" />
        </Button>
      </div>
    );

  const renderCap = () =>
    editingField === 'cap' ? (
      <div
        className="flex items-center gap-1.5"
        onBlur={(event) => {
          const nextTarget = event.relatedTarget;
          if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
            return;
          }

          void saveCap();
        }}
      >
        <span>Cap</span>
        <div className="relative">
          <span className="absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-muted-foreground">
            $
          </span>
          <Input
            autoFocus
            type="number"
            min="0"
            step="0.01"
            className="h-7 w-24 pl-5 text-xs"
            value={draftCapAmount}
            disabled={savingField !== null}
            placeholder="No cap"
            onChange={(event) => setDraftCapAmount(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void saveCap();
              }

              if (event.key === 'Escape') {
                event.preventDefault();
                setEditingField(null);
                setError('');
              }
            }}
          />
        </div>
        <span>/</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={draftCapPeriod === 'annual' ? 'secondary' : 'ghost'}
            size="xs"
            disabled={savingField !== null}
            onClick={() => setDraftCapPeriod('annual')}
          >
            annual
          </Button>
          <Button
            type="button"
            variant={draftCapPeriod === 'monthly' ? 'secondary' : 'ghost'}
            size="xs"
            disabled={savingField !== null}
            onClick={() => setDraftCapPeriod('monthly')}
          >
            mon
          </Button>
        </div>
      </div>
    ) : (
      <div className="flex items-center gap-1">
        <span>
          {rule.cap_amount != null
            ? `Cap $${formatCapAmount(rule.cap_amount)} / ${formatCapPeriodShort(
                rule.cap_period ?? 'annual',
              )}`
            : 'No cap'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5 rounded-full text-muted-foreground hover:text-foreground"
          disabled={savingField !== null}
          aria-label={`Edit cap for ${rule.category}`}
          onClick={() => startEdit('cap')}
        >
          <Pencil className="size-3" />
        </Button>
      </div>
    );

  const renderBasicRate = () =>
    editingField === 'basic-rate' ? (
      <div className="flex items-center gap-1.5">
        <span>basic reward rate</span>
        <Input
          autoFocus
          type="number"
          min="0"
          step="any"
          className="h-7 w-20 text-xs"
          value={draftBasicRate}
          disabled={savingField !== null}
          onChange={(event) => setDraftBasicRate(event.target.value)}
          onBlur={() => void saveBasicRate()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void saveBasicRate();
            }

            if (event.key === 'Escape') {
              event.preventDefault();
              setEditingField(null);
              setError('');
            }
          }}
        />
        <span>x</span>
      </div>
    ) : (
      <div className="flex items-center gap-1">
        <span>basic reward rate {formatRuleNumber(rule.fallback_rate ?? 1)}x</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5 rounded-full text-muted-foreground hover:text-foreground"
          disabled={savingField !== null}
          aria-label={`Edit basic reward rate for ${rule.category}`}
          onClick={() => startEdit('basic-rate')}
        >
          <Pencil className="size-3" />
        </Button>
      </div>
    );

  return (
    <div className="space-y-2 rounded-lg border border-border px-3 py-2 text-xs">
      <div className="flex items-start justify-between gap-3">
        <span className="font-medium">{rule.category}</span>
        <div className="flex flex-wrap items-center justify-end gap-2 text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2 rounded-full bg-muted/60 px-2 py-1">
            {renderMultiplier()}
            <span className="text-muted-foreground/60">·</span>
            {renderCap()}
          </div>
          <div className="flex items-center rounded-full bg-muted/40 px-2 py-1">
            {renderBasicRate()}
          </div>
          {rewardCurrency && (
            <span
              className="rounded-full border px-2 py-1"
              style={getRewardBadgeStyle(getRewardCurrencyColor(rewardCurrency))}
            >
              {getRewardCurrencyLabel(rewardCurrency)}
            </span>
          )}
          <span className="rounded bg-muted px-1.5 py-1">
            {rule.rule_source}
          </span>
          {savingField !== null && <span>Saving...</span>}
        </div>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
