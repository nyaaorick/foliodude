import type { Json } from './database';
import type {
  MileageManualInMetadata,
  MileageRedeemFlightMetadata,
  MileageTransferInMetadata,
} from './mileage';

export enum TransactionType {
  EXPENSE = 'EXPENSE',
  INCOME = 'INCOME',
  TRANSFER = 'TRANSFER',
  REWARD_EARN = 'REWARD_EARN',
  REWARD_TRANSFER_IN = 'REWARD_TRANSFER_IN',
  REWARD_REDEEM = 'REWARD_REDEEM',
  MILEAGE_TRANSFER_IN = 'MILEAGE_TRANSFER_IN',
  MILEAGE_MANUAL_IN = 'MILEAGE_MANUAL_IN',
  MILEAGE_REDEEM_FLIGHT = 'MILEAGE_REDEEM_FLIGHT',
  SHARE_BUY = 'SHARE_BUY',
  SHARE_SELL = 'SHARE_SELL',
}

export interface CrossCurrencyTransferMetadata {
  source_currency: string;
  target_currency: string;
  target_amount: number;
  implied_exchange_rate: number;
}

export interface AssetBalanceAdjustmentMetadata {
  kind: 'asset_balance_adjustment';
}

export type TransactionMetadata =
  | Json
  | AssetBalanceAdjustmentMetadata
  | CrossCurrencyTransferMetadata
  | MileageTransferInMetadata
  | MileageManualInMetadata
  | MileageRedeemFlightMetadata;

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  currency: string | null;
  reward_currency: string | null;
  metadata: TransactionMetadata | null;
  reference_transaction_id: string | null;
  from_account: string | null;
  to_account: string | null;
  category: string | null;
  memo: string | null;
  share_ticker: string | null;
  share_quantity: number | null;
  share_price: number | null;
  transaction_date: string;
  created_at: string;
}

export interface LinkedTransactionSummary {
  id: string;
  type: TransactionType;
  from_account: string | null;
  to_account: string | null;
}

export interface TransactionWithReward extends Transaction {
  reward?: {
    points: number;
    currency: string;
  };
  reference_transaction?: LinkedTransactionSummary | null;
}

export type CreateTransactionInput = Pick<
  Transaction,
  'type' | 'amount' | 'transaction_date'
> & {
  currency?: string | null;
  reward_currency?: string | null;
  reference_transaction_id?: string;
  from_account?: string;
  to_account?: string;
  category?: string;
  memo?: string;
};
