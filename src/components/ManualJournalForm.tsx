"use client";

import { useState } from "react";
import { Card, Field, Input, Select } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { createManualJournal } from "@/app/(app)/accounting/actions";
import { formatPeso, pesosToCentavos } from "@/lib/money";

interface Line {
  account_id: string;
  side: "debit" | "credit";
  amount: number;
}

export function ManualJournalForm({
  accounts,
  today,
}: {
  accounts: { id: string; code: string; name: string }[];
  today: string;
}) {
  const [lines, setLines] = useState<Line[]>([
    { account_id: accounts[0]?.id ?? "", side: "debit", amount: 0 },
    { account_id: accounts[0]?.id ?? "", side: "credit", amount: 0 },
  ]);

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () =>
    setLines((ls) => [...ls, { account_id: accounts[0]?.id ?? "", side: "debit", amount: 0 }]);
  const removeLine = (i: number) =>
    setLines((ls) => (ls.length > 2 ? ls.filter((_, idx) => idx !== i) : ls));

  const debit = lines.filter((l) => l.side === "debit").reduce((s, l) => s + pesosToCentavos(l.amount || 0), 0);
  const credit = lines.filter((l) => l.side === "credit").reduce((s, l) => s + pesosToCentavos(l.amount || 0), 0);
  const balanced = debit === credit && debit > 0;

  return (
    <ActionForm action={createManualJournal} className="space-y-4">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" name="entry_date" defaultValue={today} />
          </Field>
        </div>
        <Field label="Memo">
          <Input name="memo" placeholder="Description" />
        </Field>
      </Card>

      <Card className="space-y-3">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-2">
            <Field label={i === 0 ? "Account" : ""}>
              <Select
                value={l.account_id}
                onChange={(e) => update(i, { account_id: e.target.value })}
                className="text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={i === 0 ? "Side" : ""}>
              <Select
                value={l.side}
                onChange={(e) => update(i, { side: e.target.value as "debit" | "credit" })}
                className="text-sm"
              >
                <option value="debit">Dr</option>
                <option value="credit">Cr</option>
              </Select>
            </Field>
            <Field label={i === 0 ? "Amount ₱" : ""}>
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={l.amount || ""}
                onChange={(e) => update(i, { amount: parseFloat(e.target.value) || 0 })}
                className="w-24 text-sm"
              />
            </Field>
            <button
              type="button"
              onClick={() => removeLine(i)}
              className="mb-1 rounded-lg border border-gray-300 px-2 py-2 text-sm text-gray-500"
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" onClick={addLine} className="btn-secondary text-sm">
          + Add line
        </button>
      </Card>

      <Card className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Total debit</span>
          <span>{formatPeso(debit)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Total credit</span>
          <span>{formatPeso(credit)}</span>
        </div>
        <div className="flex justify-between border-t border-gray-100 pt-1">
          <span className="font-semibold">Difference</span>
          <span className={balanced ? "font-bold text-brand-700" : "font-bold text-red-600"}>
            {formatPeso(debit - credit)}
          </span>
        </div>
      </Card>

      <SubmitButton className="w-full">Post entry</SubmitButton>
      {!balanced && (
        <p className="text-center text-xs text-gray-400">
          Debits must equal credits (and be greater than zero) to post.
        </p>
      )}
    </ActionForm>
  );
}
