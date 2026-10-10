'use client';

import { useState } from 'react';
import { Plane } from 'lucide-react';
import { FormDialog, formNumber } from '@/components/app/form-dialog';
import { Field, OptionSelect, ReadOnlyValue } from '@/components/app/form-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { redeemMileageFlight } from '@/lib/actions/mileage-actions';
import { unwrap } from '@/lib/actions/result';
import { type AccountOption } from '@/lib/types/accounts';
import { localToday } from '@/lib/utils/local-date';

interface RedeemMileageFlightDialogProps {
  mileageAccountId: string;
  taxAccounts: AccountOption[];
}

function buildDefaultTicketName(dateValue: string) {
  return `Flight ${dateValue}`;
}

function formatAccountOption(account: AccountOption) {
  return `${account.name} (${account.currency})`;
}

export function RedeemMileageFlightDialog({
  mileageAccountId,
  taxAccounts,
}: RedeemMileageFlightDialogProps) {
  const [taxAccountId, setTaxAccountId] = useState(taxAccounts[0]?.id ?? '');
  const [dateValue, setDateValue] = useState(localToday);
  const [ticketName, setTicketName] = useState(() => buildDefaultTicketName(localToday()));

  const selectedTaxAccount = taxAccounts.find((account) => account.id === taxAccountId) ?? null;

  return (
    <FormDialog
      trigger={
        <Button size="sm" variant="outline">
          <Plane className="size-4" />
          Redeem Flight
        </Button>
      }
      title="Redeem Flight"
      description="Record a flight redemption and charge taxes to a liability account."
      submitLabel="Redeem Flight"
      submitDisabled={taxAccounts.length === 0}
      onOpenChange={(open) => {
        if (open) return;
        const today = localToday();
        setTaxAccountId(taxAccounts[0]?.id ?? '');
        setDateValue(today);
        setTicketName(buildDefaultTicketName(today));
      }}
      onSubmit={async (form) => {
        if (!selectedTaxAccount) throw new Error('Select a tax payment account');

        unwrap(
          await redeemMileageFlight({
            mileageAccountId,
            ticketName,
            miles: formNumber(form, 'miles'),
            taxAccountId: selectedTaxAccount.id,
            taxAmount: formNumber(form, 'taxAmount'),
            taxCurrency: selectedTaxAccount.currency,
            date: dateValue,
          }),
        );
      }}
    >
      <Field label="Ticket Name" htmlFor="ticketName">
        <Input
          id="ticketName"
          name="ticketName"
          required
          value={ticketName}
          onChange={(event) => setTicketName(event.target.value)}
        />
      </Field>

      <Field label="Miles Used" htmlFor="miles">
        <Input id="miles" name="miles" type="number" min="1" step="1" required />
      </Field>

      <Field label="Tax Payment Account">
        <OptionSelect
          value={taxAccountId}
          onChange={setTaxAccountId}
          options={taxAccounts.map((account) => ({
            value: account.id,
            label: formatAccountOption(account),
          }))}
          placeholder="Select liability account"
        />
      </Field>

      <Field
        label={`Tax Amount ${selectedTaxAccount ? `(${selectedTaxAccount.currency})` : ''}`}
        htmlFor="taxAmount"
      >
        <Input
          id="taxAmount"
          name="taxAmount"
          type="number"
          min="0.01"
          step="0.01"
          required
          placeholder="0.00"
        />
      </Field>

      <ReadOnlyValue label="Tax Currency">
        {selectedTaxAccount?.currency ?? 'Select account first'}
      </ReadOnlyValue>

      {/* Controlled: changing the date also renames a still-default ticket. */}
      <Field label="Date" htmlFor="date">
        <Input
          id="date"
          name="date"
          type="date"
          required
          value={dateValue}
          onChange={(event) => {
            const nextDateValue = event.target.value;
            if (!ticketName || ticketName === buildDefaultTicketName(dateValue)) {
              setTicketName(buildDefaultTicketName(nextDateValue));
            }
            setDateValue(nextDateValue);
          }}
        />
      </Field>

      {taxAccounts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Add a liability account first to pay flight taxes.
        </p>
      )}
    </FormDialog>
  );
}
