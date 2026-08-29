export const EXPENSE_CATEGORIES = [
  'Dining',
  'Grocery',
  'Transit',
  'Travel',
  'Shopping',
  'Other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
