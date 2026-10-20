const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** ₹6,495.00 — for messages shown to staff. */
export function formatPaise(paise: number): string {
  return rupees.format(paise / 100);
}
