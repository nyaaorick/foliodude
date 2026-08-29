'use client';

import { useEffect, useState } from 'react';
import { updateMileageRate } from '@/lib/actions/mileage-actions';
import { REWARD_CURRENCIES } from '@/lib/types/rewards';
import {
  estimateMileageUsd,
  getAirlineProgramDefinition,
  type AirlineProgram,
  type MileageTransferRateMap,
} from '@/lib/types/mileage';
import { InlineValuationEditor } from './inline-valuation-editor';
import { MileageTransferRatesDialog } from './mileage-transfer-rates-dialog';

interface MileageBalanceCardProps {
  accountId: string;
  airlineProgram: AirlineProgram;
  miles: number;
  usdPer10kMiles: number;
  transferRates: MileageTransferRateMap;
  compact?: boolean;
}

export function MileageBalanceCard({
  accountId,
  airlineProgram,
  miles,
  usdPer10kMiles,
  transferRates,
  compact = false,
}: MileageBalanceCardProps) {
  const [rate, setRate] = useState(usdPer10kMiles);
  const [localTransferRates, setLocalTransferRates] = useState(transferRates);
  const program = getAirlineProgramDefinition(airlineProgram);

  useEffect(() => {
    setRate(usdPer10kMiles);
  }, [usdPer10kMiles]);

  useEffect(() => {
    setLocalTransferRates(transferRates);
  }, [transferRates]);

  const estimateUsd = estimateMileageUsd(miles, rate);
  const transferRateSummary = REWARD_CURRENCIES.map(
    (currency) => `1 ${currency.id} = ${localTransferRates[currency.id] ?? 0} miles`,
  ).join(' · ');

  return (
    <div className="space-y-2">
      <InlineValuationEditor
        title={`${miles.toLocaleString()} miles`}
        subtitle={program ? `${program.displayName} · ${program.airlineName}` : airlineProgram}
        quantityLabel={`10k miles = $${rate.toLocaleString()} USD`}
        rate={rate}
        rateLabel="10k miles ="
        estimateLabel={rate > 0 ? `≈ $${estimateUsd.toLocaleString()} USD` : undefined}
        compact={compact}
        onSave={async (nextRate) => {
          const result = await updateMileageRate({
            accountId,
            usdPer10kMiles: nextRate,
          });

          if (!result.success) {
            return result;
          }

          setRate(nextRate);
          return { success: true };
        }}
      />

      <div
        className={
          compact
            ? 'flex items-center justify-between gap-2 rounded-md border px-2 py-1.5'
            : 'flex items-center justify-between gap-3 rounded-md border px-3 py-2'
        }
      >
        <div className="min-w-0">
          <p className={compact ? 'text-xs font-medium' : 'text-sm font-medium'}>
            Transfer Rates
          </p>
          <p className="text-xs text-muted-foreground">{transferRateSummary}</p>
        </div>

        {!compact && (
          <MileageTransferRatesDialog
            accountId={accountId}
            transferRates={localTransferRates}
            onSaved={setLocalTransferRates}
          />
        )}
      </div>
    </div>
  );
}
