import { TransactionType } from '@/lib/types/transactions';

export const SUPPORTED_DELETE_TRANSACTION_TYPES = new Set<TransactionType>([
  TransactionType.TRANSFER,
  TransactionType.INCOME,
  TransactionType.EXPENSE,
  TransactionType.REWARD_EARN,
  TransactionType.REWARD_TRANSFER_IN,
  TransactionType.REWARD_REDEEM,
  TransactionType.MILEAGE_TRANSFER_IN,
  TransactionType.MILEAGE_MANUAL_IN,
  TransactionType.MILEAGE_REDEEM_FLIGHT,
  TransactionType.SHARE_BUY,
  TransactionType.SHARE_SELL,
]);

export function canDeleteTransactionType(type: TransactionType) {
  return SUPPORTED_DELETE_TRANSACTION_TYPES.has(type);
}
