import { Field, OptionSelect, ReadOnlyValue } from '@/components/app/form-fields';
import { Input } from '@/components/ui/input';
import { AccountType, SUPPORTED_CURRENCIES, type CurrencyId } from '@/lib/types/accounts';
import { EXPENSE_CATEGORIES } from '@/lib/data/expense-categories';
import { REWARD_CURRENCY_IDS } from '@/lib/types/rewards';
import { normalizeName } from '../protocol/action-registry';
import type { IntentDraft } from '../application/intent-draft';
export type EditableAction = Record<string, unknown>;
const currencies = Object.keys(SUPPORTED_CURRENCIES).map(value => ({ value, label: value }));
const numeric = (value: string) => value.trim() === '' ? NaN : Number(value);
const inputNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : '';
export function IntentActionFields({ action, index, actions, draft, change }: {
    action: EditableAction;
    index: number;
    actions: EditableAction[];
    draft: IntentDraft;
    change: (index: number, key: string, value: unknown) => void;
}) {
    const id = (key: string) => `intent-${index}-${key}`;
    const numberField = (key: string, label: string, value = action[key], owed = false) => <Field label={label} htmlFor={id(key)}><Input id={id(key)} type="number" step="0.01" value={inputNumber(owed && typeof value === 'number' ? Math.abs(value) : value)} onChange={event => change(index, key, owed ? -Math.abs(numeric(event.target.value)) : numeric(event.target.value))}/></Field>;
    const choices = [...draft.accounts, ...actions.slice(0, index).filter(step => step.action === 'create_account').map((step, position) => ({ id: `new-${position}`, name: String(step.name ?? ''), currency: (step.currency ?? 'USD') as CurrencyId, type: step.type ?? 'ASSET', balance: Number(step.balance ?? 0) }))];
    const selectedAccount = (key: string) => { const currency = action[key === 'from' ? 'fromCurrency' : key === 'to' ? 'toCurrency' : 'currency']; return choices.find(account => normalizeName(account.name) === normalizeName(String(action[key] ?? '')) && (!currency || account.currency === currency)); };
    const accountField = (key: 'account' | 'from' | 'to', label: string) => <Field label={label} htmlFor={id(key)}><OptionSelect id={id(key)} value={selectedAccount(key)?.id ?? ''} options={choices.filter(account => key !== 'from' || account.type === AccountType.ASSET).map(account => ({ value: account.id, label: `${account.name} (${account.currency})` }))} placeholder="Choose an account" onChange={value => { const account = choices.find(item => item.id === value)!; change(index, key, account.name); change(index, key === 'from' ? 'fromCurrency' : key === 'to' ? 'toCurrency' : 'currency', account.currency); }}/></Field>;
    return (<div className="grid gap-4 sm:grid-cols-2">
              {action.action === 'create_account' ? <>
                <Field label="Account name" htmlFor={id('name')}><Input id={id('name')} value={String(action.name ?? '')} onChange={event => change(index, 'name', event.target.value)}/></Field>
                <Field label="Account type" htmlFor={id('type')}><OptionSelect id={id('type')} value={String(action.type)} onChange={value => { change(index, 'type', value); if (typeof action.balance === 'number')
            change(index, 'balance', value === 'LIABILITY' ? -Math.abs(action.balance) : Math.abs(action.balance)); }} options={[{ value: 'ASSET', label: 'Asset / cash' }, { value: 'LIABILITY', label: 'Credit card / debt' }]}/></Field>
                <Field label="Currency" htmlFor={id('currency')}><OptionSelect id={id('currency')} value={String(action.currency)} onChange={value => change(index, 'currency', value)} options={currencies}/></Field>
                {numberField('balance', action.type === 'LIABILITY' ? 'Amount owed' : 'Starting balance', action.balance, action.type === 'LIABILITY')}
                {action.type === 'LIABILITY' && <>{numberField('credit_limit', 'Credit limit')}<Field label="Reward currency" htmlFor={id('reward_currency')}><OptionSelect id={id('reward_currency')} value={String(action.reward_currency ?? 'none')} onChange={value => change(index, 'reward_currency', value === 'none' ? null : value)} options={[{ value: 'none', label: 'None' }, ...REWARD_CURRENCY_IDS.map(value => ({ value, label: value }))]}/></Field></>}
              </> : action.action === 'expense' ? <>
                {accountField('account', 'Paying account')}{numberField('amount', 'Expense amount')}
                <Field label="Date" htmlFor={id('date')}><Input id={id('date')} type="date" value={String(action.date ?? draft.today)} onChange={event => change(index, 'date', event.target.value)}/></Field>
                {selectedAccount('account')?.type === AccountType.LIABILITY ? <Field label="Category" htmlFor={id('category')}><OptionSelect id={id('category')} value={String(action.category ?? 'Other')} onChange={value => change(index, 'category', value)} options={EXPENSE_CATEGORIES.map(value => ({ value, label: value }))}/></Field> : <ReadOnlyValue label="Category">Other</ReadOnlyValue>}
              </> : <>
                {accountField('from', 'From')}{accountField('to', 'To')}
                <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={action.amount === 'all'} onChange={event => change(index, 'amount', event.target.checked ? 'all' : 1)}/>Entire remaining balance</label>
                {action.amount !== 'all' && numberField('amount', 'Transfer amount')}
                {selectedAccount('from')?.currency !== selectedAccount('to')?.currency && numberField('targetAmount', 'Amount received (destination currency)')}
              </>}
              {action.action !== 'create_account' && <Field label="Memo (optional)" htmlFor={id('memo')}><Input id={id('memo')} value={String(action.memo ?? '')} onChange={event => change(index, 'memo', event.target.value)}/></Field>}
            </div>);
}
