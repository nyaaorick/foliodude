'use client';

import { useMemo, useState } from 'react';
import { Plane } from 'lucide-react';
import { revalidate } from '@/lib/data/store';
import { redeemMileageFlight } from '@/lib/actions/mileage-actions';
import { type AccountOption } from '@/lib/types/accounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
  const [open, setOpen] = useState(false);
  const [taxAccountId, setTaxAccountId] = useState(taxAccounts[0]?.id ?? '');
  const [dateValue, setDateValue] = useState(localToday);
  const [ticketName, setTicketName] = useState(() =>
    buildDefaultTicketName(localToday()),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedTaxAccount = useMemo(
    () => taxAccounts.find((account) => account.id === taxAccountId) ?? null,
    [taxAccounts, taxAccountId],
  );

  const resetState = () => {
    setTaxAccountId(taxAccounts[0]?.id ?? '');
    const nextDateValue = localToday();
    setDateValue(nextDateValue);
    setTicketName(buildDefaultTicketName(nextDateValue));
    setSubmitting(false);
    setError('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetState();
        }
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Plane className="size-4" />
            Redeem Flight
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Redeem Flight</DialogTitle>
          <DialogDescription>
            Record a flight redemption and charge taxes to a liability account.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!selectedTaxAccount) {
              setError('Select a tax payment account');
              return;
            }

            setError('');
            setSubmitting(true);

            const form = new FormData(event.currentTarget);
            const miles = Number.parseInt((form.get('miles') as string) || '0', 10);
            const taxAmount = Number.parseFloat((form.get('taxAmount') as string) || '0');
            const result = await redeemMileageFlight({
              mileageAccountId,
              ticketName,
              miles,
              taxAccountId: selectedTaxAccount.id,
              taxAmount,
              taxCurrency: selectedTaxAccount.currency,
              date: new Date(dateValue).toISOString(),
            });

            setSubmitting(false);

            if (!result.success) {
              setError(result.error);
              return;
            }

            setOpen(false);
            revalidate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="ticketName">Ticket Name</Label>
            <Input
              id="ticketName"
              name="ticketName"
              required
              value={ticketName}
              onChange={(event) => setTicketName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="miles">Miles Used</Label>
            <Input
              id="miles"
              name="miles"
              type="number"
              min="1"
              step="1"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Tax Payment Account</Label>
            <Select
              value={taxAccountId}
              onValueChange={(value) => value && setTaxAccountId(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select liability account">
                  {selectedTaxAccount ? formatAccountOption(selectedTaxAccount) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {taxAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {formatAccountOption(account)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="taxAmount">
              Tax Amount {selectedTaxAccount ? `(${selectedTaxAccount.currency})` : ''}
            </Label>
            <Input
              id="taxAmount"
              name="taxAmount"
              type="number"
              min="0.01"
              step="0.01"
              required
              placeholder="0.00"
            />
          </div>

          <div className="space-y-2">
            <Label>Tax Currency</Label>
            <div className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
              {selectedTaxAccount?.currency ?? 'Select account first'}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              name="date"
              type="date"
              required
              value={dateValue}
              onChange={(event) => {
                const nextDateValue = event.target.value;
                const currentDefaultTicketName = buildDefaultTicketName(dateValue);

                setDateValue(nextDateValue);
                if (!ticketName || ticketName === currentDefaultTicketName) {
                  setTicketName(buildDefaultTicketName(nextDateValue));
                }
              }}
            />
          </div>

          {taxAccounts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Add a liability account first to pay flight taxes.
            </p>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={submitting || taxAccounts.length === 0}>
              {submitting ? 'Saving...' : 'Redeem Flight'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
