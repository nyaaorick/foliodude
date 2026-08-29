import { AccountType, SUPPORTED_CURRENCIES, type CurrencyId } from '@/lib/types/accounts';
import {
  AIRLINE_PROGRAMS,
  type AirlineProgram,
  type AirlineProgramDefinition,
} from '@/lib/types/mileage';
import {
  REWARD_CURRENCIES,
  type RewardCapPeriod,
  type RewardCurrencyDefinition,
  type RewardCurrencyId,
} from '@/lib/types/rewards';
import { TransactionType } from '@/lib/types/transactions';

type LabelVariant = 'short' | 'full';

function fail(message: string): never {
  throw new Error(message);
}

function getAirlineProgramDefinitionStrict(
  program: AirlineProgram,
): AirlineProgramDefinition {
  const definition = AIRLINE_PROGRAMS.find((item) => item.id === program);
  if (!definition) {
    fail(`Unknown airline program: ${String(program)}`);
  }
  return definition;
}

function getRewardCurrencyDefinitionStrict(
  currency: RewardCurrencyId,
): RewardCurrencyDefinition {
  const definition = REWARD_CURRENCIES.find((item) => item.id === currency);
  if (!definition) {
    fail(`Unknown reward currency: ${String(currency)}`);
  }
  return definition;
}

export function getAccountTypeLabel(type: AccountType): string {
  switch (type) {
    case AccountType.ASSET:
      return 'Asset';
    case AccountType.LIABILITY:
      return 'Liability';
    case AccountType.AIRLINE_MILES:
      return 'Airline Miles';
    case AccountType.SHARE:
      return 'Share';
    default:
      return fail(`Unknown account type: ${String(type)}`);
  }
}

export function getAirlineProgramLabel(
  program: AirlineProgram,
  variant: LabelVariant = 'short',
): string {
  const definition = getAirlineProgramDefinitionStrict(program);

  switch (variant) {
    case 'short':
      return definition.displayName;
    case 'full':
      return `${definition.displayName} · ${definition.airlineName}`;
    default:
      return fail(`Unknown airline program label variant: ${String(variant)}`);
  }
}

export function getRewardCurrencyLabel(
  currency: RewardCurrencyId,
  variant: LabelVariant = 'short',
): string {
  const definition = getRewardCurrencyDefinitionStrict(currency);

  switch (variant) {
    case 'short':
      return definition.displayName;
    case 'full':
      return `${definition.id} · ${definition.displayName}`;
    default:
      return fail(`Unknown reward currency label variant: ${String(variant)}`);
  }
}

export function getRewardCurrencyChoiceLabel(
  currency: RewardCurrencyId | 'NONE',
  variant: LabelVariant = 'short',
): string {
  if (currency === 'NONE') {
    return 'No rewards';
  }

  return getRewardCurrencyLabel(currency, variant);
}

export function getCurrencyLabel(currency: CurrencyId): string {
  const definition = SUPPORTED_CURRENCIES[currency];
  if (!definition) {
    fail(`Unknown currency: ${String(currency)}`);
  }

  return `${definition.id} - ${definition.name}`;
}

export function getTransactionTypeLabel(type: TransactionType): string {
  switch (type) {
    case TransactionType.EXPENSE:
      return 'Expense';
    case TransactionType.INCOME:
      return 'Income';
    case TransactionType.TRANSFER:
      return 'Transfer';
    case TransactionType.REWARD_EARN:
      return 'Reward Earn';
    case TransactionType.REWARD_TRANSFER_IN:
      return 'Add Points';
    case TransactionType.REWARD_REDEEM:
      return 'Deduct Points';
    case TransactionType.MILEAGE_TRANSFER_IN:
      return 'Mileage Transfer In';
    case TransactionType.MILEAGE_MANUAL_IN:
      return 'Mileage Manual In';
    case TransactionType.MILEAGE_REDEEM_FLIGHT:
      return 'Mileage Redeem Flight';
    case TransactionType.SHARE_BUY:
      return 'Buy Share';
    case TransactionType.SHARE_SELL:
      return 'Sell Share';
    default:
      return fail(`Unknown transaction type: ${String(type)}`);
  }
}

export function getRewardCapPeriodLabel(period: RewardCapPeriod): string {
  switch (period) {
    case 'annual':
      return 'Annual';
    case 'monthly':
      return 'Monthly';
    default:
      return fail(`Unknown reward cap period: ${String(period)}`);
  }
}

export function getRewardCurrencyColor(currency: RewardCurrencyId): string {
  return getRewardCurrencyDefinitionStrict(currency).color;
}
