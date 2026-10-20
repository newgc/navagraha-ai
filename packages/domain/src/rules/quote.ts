/**
 * Deterministic quote arithmetic (FS §10.1, NFR-17): the same lines always give the same total.
 * All money is integer paise. Tax per line is entered explicitly until D-07 sets tax rules.
 */

export interface QuoteLineInput {
  kind: string;
  description: string;
  quantity: number;
  unitPricePaise: number;
  taxPaise: number;
}

export interface CalculatedQuote {
  lines: (QuoteLineInput & { seq: number; lineTotalPaise: number })[];
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
}

/** Keeps totals far inside Number.MAX_SAFE_INTEGER. ₹1 crore per quote is plenty for the MVP. */
export const MAX_QUOTE_TOTAL_PAISE = 1_00_00_000_00;

const isMoney = (n: number) => Number.isSafeInteger(n) && n >= 0;

export function calculateQuote(lines: readonly QuoteLineInput[]): CalculatedQuote {
  if (lines.length === 0) throw new Error('A quote needs at least one line');
  let subtotalPaise = 0;
  let taxPaise = 0;
  const out = lines.map((l, i) => {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 1000) {
      throw new Error(`Line ${i + 1}: quantity must be a whole number from 1 to 1000`);
    }
    if (!isMoney(l.unitPricePaise) || !isMoney(l.taxPaise)) {
      throw new Error(`Line ${i + 1}: amounts must be whole, non-negative paise`);
    }
    const net = l.quantity * l.unitPricePaise;
    subtotalPaise += net;
    taxPaise += l.taxPaise;
    return { ...l, seq: i + 1, lineTotalPaise: net + l.taxPaise };
  });
  const totalPaise = subtotalPaise + taxPaise;
  if (totalPaise > MAX_QUOTE_TOTAL_PAISE) throw new Error('Quote total is implausibly large');
  return { lines: out, subtotalPaise, taxPaise, totalPaise };
}
