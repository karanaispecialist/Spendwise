export type AccountType = 'Credit Card' | 'Debit Card' | 'UPI' | 'Cash';

export interface Account {
  id?: string;
  name: string;
  type: AccountType;
  balance?: number;
  userId: string;
}

export interface Expense {
  id?: string;
  amount: number;
  category: string;
  paymentMethodId: string; // References Account.id
  paymentMethodName: string; // For easy display
  description: string;
  date: string; // ISO string
  userId: string;
  isRecurring?: boolean;
  recurringId?: string;
}

export interface Budget {
  id?: string;
  category: string;
  amount: number;
  period: 'weekly' | 'monthly';
  userId: string;
}

export interface RecurringExpense {
  id?: string;
  amount: number;
  category: string;
  paymentMethodId: string;
  paymentMethodName: string;
  description: string;
  startDate: string;
  endDate?: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  userId: string;
  lastLoggedDate?: string;
}

export const CATEGORIES = [
  'Food',
  'Entertainment',
  'Transport',
  'Shopping',
  'Bills',
  'Health',
  'Education',
  'Others'
];

export const ACCOUNT_TYPES: AccountType[] = ['Credit Card', 'Debit Card', 'UPI', 'Cash'];
export const BUDGET_PERIODS = ['weekly', 'monthly'] as const;
export const RECURRING_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
