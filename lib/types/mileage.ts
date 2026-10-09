import type { RewardCurrencyId } from './rewards';

export const AIRLINE_PROGRAMS = [
  {
    id: 'KRISFLYER',
    displayName: 'KrisFlyer',
    airlineName: 'Singapore Airlines',
  },
  {
    id: 'AVIOS',
    displayName: 'Avios',
    airlineName: 'British Airways / Iberia / Qatar Airways',
  },
  {
    id: 'ASIA_MILES',
    displayName: 'Asia Miles',
    airlineName: 'Cathay Pacific',
  },
  {
    id: 'ALASKA_AS',
    displayName: 'Alaska Mileage Plan',
    airlineName: 'Alaska Airlines (AS)',
  },
  {
    id: 'UNITED_MILEAGEPLUS',
    displayName: 'United MileagePlus',
    airlineName: 'United Airlines',
  },
] as const;

export type AirlineProgramDefinition = (typeof AIRLINE_PROGRAMS)[number];
export type AirlineProgram = AirlineProgramDefinition['id'];
export const AIRLINE_PROGRAM_IDS = AIRLINE_PROGRAMS.map(
  (program) => program.id,
) as [AirlineProgram, ...AirlineProgram[]];

export type MileageTransferRateMap = Record<string, number>;

export interface MileageTransferSourceMetadata {
  account_id: string;
  account_name_snapshot: string;
  points_deducted: number;
}

export interface MileageTransferInMetadata {
  reward_currency: RewardCurrencyId;
  airline_program: AirlineProgram;
  total_source_points: number;
  transferred_miles: number;
  ratio_snapshot: {
    reward_currency: RewardCurrencyId;
    miles_per_point: number;
  };
  sources: MileageTransferSourceMetadata[];
}

export interface MileageManualInMetadata {
  source_description: string;
}

export interface MileageRedeemFlightMetadata {
  ticket_name: string;
  tax_amount: number;
  tax_currency: string;
  tax_account_id: string;
  tax_account_name_snapshot: string;
}

export function getAirlineProgramDefinition(
  id: string,
): AirlineProgramDefinition | undefined {
  return AIRLINE_PROGRAMS.find((program) => program.id === id);
}

export function estimateMileageUsd(
  miles: number,
  usdPer10kMiles: number,
): number {
  return Math.round((miles / 10000) * usdPer10kMiles);
}
