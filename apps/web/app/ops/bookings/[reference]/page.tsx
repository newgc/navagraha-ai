import { notFound } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Badge } from '@/components/badge';
import { api, errorText, type Me } from '@/lib/api';
import {
  AGE_BANDS,
  PAYMENT_METHODS,
  RELATIONSHIPS,
  formatDate,
  formatDateTime,
  formatRupees,
  humanize,
  todayIso,
} from '@/lib/format';
import {
  addReplacement,
  confirmPayment,
  confirmSupplier,
  declineSupplier,
  recordPayment,
  rejectPayment,
  requestSupplier,
  waiveBalance,
} from './actions';
import {
  ChangesPanel,
  RefundsBlock,
  type Cancellation,
  type ChangeRequest,
  type Refunds,
} from './changes-panel';

interface Booking {
  id: string;
  reference: string;
  state: string;
  startDate: string;
  template: string;
  mode: string;
  seniorFriendly: boolean;
  tier: string | null;
  pickup: { location: string | null; time: string | null };
  source: { channel: string; reference: string | null };
  notes: string | null;
  booker: { name: string | null; phone: string | null; email: string | null };
  travellers: {
    id: string;
    fullName: string;
    ageBand: string;
    relationshipToBooker: string;
    needsWheelchair: boolean;
    mobilityNotes: string | null;
    isLead: boolean;
  }[];
  itinerary: {
    version: number;
    state: string;
    validation: { level: string; engineChecked: boolean; warnings: { message: string }[] } | null;
    stops: {
      seq: number;
      day: number;
      plannedArrival: string | null;
      templeCode: string;
      templeName: string;
    }[];
  } | null;
  quote: {
    version: number;
    state: string;
    subtotalPaise: number;
    taxPaise: number;
    totalPaise: number;
    validUntil: string;
    acceptedVia: string | null;
    lines: {
      seq: number;
      kind: string;
      description: string;
      quantity: number;
      unitPricePaise: number;
      taxPaise: number;
      lineTotalPaise: number;
    }[];
  } | null;
  payment: {
    totalPaise: number;
    paidPaise: number;
    duePaise: number;
    items: {
      id: string;
      state: string;
      method: string;
      amountPaise: number;
      capturedPaise: number;
      refundedPaise: number;
      reference: string | null;
      receivedOn: string | null;
      recordedBy: string | null;
      confirmedBy: string | null;
      reason: string | null;
    }[];
  };
  fulfilment: {
    state: string;
    components: {
      id: string;
      slot: string;
      kind: string;
      mandatory: boolean;
      state: string;
      supplierName: string | null;
      supplierReference: string | null;
      capacity: number | null;
    }[];
  };
  confirmation: { open: boolean; waitingFor?: string[] };
  trip: { id: string; state: string } | null;
  changeRequests: ChangeRequest[];
  cancellations: Cancellation[];
  refunds: Refunds;
  history: {
    machine: string;
    from: string | null;
    to: string;
    actorRole: string;
    reason: string | null;
    recordedAt: string;
  }[];
}

const MACHINE_LABELS: Record<string, string> = {
  FulfilmentComponent: 'Supplier item',
  ChangeRequest: 'Change request',
};

const OPEN = ['REQUESTED', 'PENDING_CONFIRMATION', 'CONFIRMED', 'IN_PROGRESS'];

export default async function BookingPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const [r, me] = await Promise.all([api<Booking>(`/bookings/${reference}`), api<Me>('/me')]);
  if (!r.ok && (r.status === 404 || r.status === 400)) notFound();
  if (!r.ok)
    return (
      <p role="alert" className="error">
        {errorText(r.error)}
      </p>
    );
  const b = r.data;
  const roles = me.ok ? me.data.roles : [];
  const myId = me.ok ? me.data.id : null;
  const isOps = roles.includes('OPS_COORDINATOR') || roles.includes('OPS_MANAGER');
  const isManager = roles.includes('OPS_MANAGER');
  const canRecord = isOps || roles.includes('FINANCE');
  const canConfirmPay = isManager || roles.includes('FINANCE');
  const open = OPEN.includes(b.state);
  const replaceable = new Set(
    b.fulfilment.components
      .filter((c) => ['DECLINED', 'CANCELLED', 'RELEASED'].includes(c.state))
      .filter(
        (c) =>
          !b.fulfilment.components.some(
            (o) => o.slot === c.slot && ['PENDING', 'REQUESTED', 'CONFIRMED'].includes(o.state),
          ),
      )
      .map((c) => c.slot),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>
            {b.reference} <Badge state={b.state} />
          </h1>
          <p className="muted">
            {formatDate(b.startDate)} · {b.template === '2D1N' ? '2 days / 1 night' : '1 day'} ·{' '}
            {humanize(b.mode)}
            {b.seniorFriendly && ' · Senior-Friendly'} · via {humanize(b.source.channel)}
          </p>
        </div>
        <div className={`gate ${b.confirmation.open ? 'good' : 'warn'}`}>
          {b.state === 'CONFIRMED' || b.confirmation.open
            ? 'Confirmed: payment and all required suppliers are done'
            : `Waiting for ${(b.confirmation.waitingFor ?? []).map((w) => (w === 'PAYMENT' ? 'payment' : 'supplier confirmation')).join(' and ')}`}
          {b.trip && <div className="small">Trip {humanize(b.trip.state).toLowerCase()}</div>}
        </div>
      </div>

      <div className="grid">
        <section className="card">
          <h2>Booker and travellers</h2>
          <p>
            <strong>{b.booker.name ?? 'Unnamed'}</strong> · {b.booker.phone}
            {b.booker.email && ` · ${b.booker.email}`}
          </p>
          <ul className="plain">
            {b.travellers.map((t) => (
              <li key={t.id}>
                {t.fullName} {t.isLead && <span className="badge neutral">Lead</span>}
                <span className="muted small">
                  {' '}
                  · {AGE_BANDS[t.ageBand] ?? t.ageBand} ·{' '}
                  {RELATIONSHIPS[t.relationshipToBooker] ?? t.relationshipToBooker}
                  {t.needsWheelchair && ' · wheelchair'}
                  {t.mobilityNotes && ` · ${t.mobilityNotes}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="small">
            Pickup: {b.pickup.location ?? '—'}
            {b.pickup.time && ` at ${b.pickup.time.slice(0, 5)}`}
          </p>
          {b.notes && <p className="small">Notes: {b.notes}</p>}
        </section>

        <section className="card">
          <h2>
            Itinerary v{b.itinerary?.version} {b.itinerary && <Badge state={b.itinerary.state} />}
          </h2>
          {b.itinerary?.validation && !b.itinerary.validation.engineChecked && (
            <p className="notice">
              Planned by hand and signed off by the coordinator — not checked by the planning engine
              (D-20).
            </p>
          )}
          {b.itinerary?.validation?.warnings.map((w) => (
            <p key={w.message} className="notice small">
              {w.message}
            </p>
          ))}
          <ol>
            {b.itinerary?.stops.map((s) => (
              <li key={s.seq}>
                {b.template === '2D1N' && <span className="muted">Day {s.day} · </span>}
                {s.templeName}
                {s.plannedArrival && (
                  <span className="muted"> · arrive {s.plannedArrival.slice(0, 5)}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="card">
        <h2>Suppliers {<Badge state={b.fulfilment.state} />}</h2>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Supplier</th>
              <th>State</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {b.fulfilment.components.map((c) => (
              <tr key={c.id}>
                <td>
                  {humanize(c.kind)} <span className="muted small">{c.slot}</span>
                  {!c.mandatory && <span className="muted small"> · optional</span>}
                </td>
                <td>
                  {c.supplierName ?? '—'}
                  {c.supplierReference && (
                    <div className="muted small">Ref {c.supplierReference}</div>
                  )}
                  {c.capacity && <div className="muted small">{c.capacity} seats</div>}
                </td>
                <td>
                  <Badge state={c.state} />
                </td>
                <td>
                  {isOps && open && c.state === 'PENDING' && (
                    <ActionForm
                      action={requestSupplier.bind(null, b.reference, c.id)}
                      label="Mark as requested"
                      inline
                    >
                      <input
                        name="supplierName"
                        placeholder="Supplier"
                        defaultValue={c.supplierName ?? ''}
                        aria-label="Supplier"
                      />
                    </ActionForm>
                  )}
                  {isOps && open && c.state === 'REQUESTED' && (
                    <>
                      <ActionForm
                        action={confirmSupplier.bind(null, b.reference, c.id)}
                        label="Confirm"
                        inline
                      >
                        <input
                          name="supplierReference"
                          placeholder="Supplier reference"
                          required
                          aria-label="Supplier reference"
                        />
                        {c.kind === 'VEHICLE' && (
                          <input
                            name="capacity"
                            type="number"
                            min={1}
                            placeholder="Seats"
                            defaultValue={c.capacity ?? ''}
                            aria-label="Seats"
                            required
                          />
                        )}
                      </ActionForm>
                      <ActionForm
                        action={declineSupplier.bind(null, b.reference, c.id)}
                        label="Declined"
                        variant="danger"
                        inline
                      >
                        <input
                          name="reason"
                          placeholder="Why"
                          required
                          aria-label="Decline reason"
                        />
                      </ActionForm>
                    </>
                  )}
                  {isOps && open && replaceable.has(c.slot) && c.state === 'DECLINED' && (
                    <ActionForm
                      action={addReplacement.bind(null, b.reference, c.slot, c.kind)}
                      label="Add replacement"
                      variant="secondary"
                      inline
                    >
                      <input
                        name="supplierName"
                        placeholder="New supplier"
                        aria-label="New supplier"
                      />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid">
        <section className="card">
          <h2>
            Quote v{b.quote?.version} {b.quote && <Badge state={b.quote.state} />}
          </h2>
          <table>
            <tbody>
              {b.quote?.lines.map((l) => (
                <tr key={l.seq}>
                  <td>
                    {l.description}
                    <div className="muted small">
                      {l.quantity} × {formatRupees(l.unitPricePaise)}
                      {l.taxPaise > 0 && ` + tax ${formatRupees(l.taxPaise)}`}
                    </div>
                  </td>
                  <td className="num">{formatRupees(l.lineTotalPaise)}</td>
                </tr>
              ))}
              <tr>
                <td>Subtotal</td>
                <td className="num">{formatRupees(b.quote?.subtotalPaise)}</td>
              </tr>
              <tr>
                <td>Tax</td>
                <td className="num">{formatRupees(b.quote?.taxPaise)}</td>
              </tr>
              <tr className="total">
                <td>Total</td>
                <td className="num">{formatRupees(b.quote?.totalPaise)}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small">
            Priced by hand · valid until {formatDateTime(b.quote?.validUntil)} · accepted via{' '}
            {humanize(b.quote?.acceptedVia)}
          </p>
        </section>

        <section className="card">
          <h2>Payments</h2>
          <p>
            Paid {formatRupees(b.payment.paidPaise)} of {formatRupees(b.payment.totalPaise)} ·{' '}
            <strong>Due {formatRupees(b.payment.duePaise)}</strong>
          </p>
          <ul className="plain">
            {b.payment.items.map((p) => (
              <li key={p.id} className="payment">
                <div>
                  {formatRupees(p.amountPaise)} · {PAYMENT_METHODS[p.method] ?? humanize(p.method)}{' '}
                  {p.reference && `· ${p.reference}`}{' '}
                  {p.receivedOn && (
                    <span className="muted small">received {formatDate(p.receivedOn)}</span>
                  )}{' '}
                  <Badge state={p.state} />
                  {p.reason && <div className="muted small">{p.reason}</div>}
                </div>
                {p.state === 'PENDING' && canConfirmPay && p.recordedBy !== myId && (
                  <div className="row">
                    <ActionForm
                      action={confirmPayment.bind(null, b.reference, p.id)}
                      label="Confirm received"
                      inline
                    />
                    <ActionForm
                      action={rejectPayment.bind(null, b.reference, p.id)}
                      label="Reject"
                      variant="danger"
                      inline
                    >
                      <input name="reason" placeholder="Why" required aria-label="Reject reason" />
                    </ActionForm>
                  </div>
                )}
                {p.state === 'PENDING' && p.recordedBy === myId && (
                  <p className="muted small">
                    You recorded this — someone else in Finance or a manager must confirm it (D-19).
                  </p>
                )}
              </li>
            ))}
          </ul>
          {open && canRecord && b.payment.duePaise > 0 && (
            <details>
              <summary>Record a payment received</summary>
              <ActionForm action={recordPayment.bind(null, b.reference)} label="Record payment">
                <label>
                  Method
                  <select name="method" defaultValue="OFFLINE_UPI">
                    <option value="OFFLINE_UPI">UPI</option>
                    <option value="OFFLINE_BANK_TRANSFER">Bank transfer</option>
                    <option value="CASH">Cash</option>
                  </select>
                </label>
                <label>
                  Amount (₹)
                  <input
                    name="amount"
                    inputMode="decimal"
                    required
                    placeholder={String(b.payment.duePaise / 100)}
                  />
                </label>
                <label>
                  UPI / bank reference or receipt no.
                  <input name="reference" required />
                </label>
                <label>
                  Received on
                  <input
                    name="receivedOn"
                    type="date"
                    required
                    defaultValue={todayIso()}
                    max={todayIso()}
                  />
                </label>
              </ActionForm>
            </details>
          )}
          {open && isManager && b.payment.duePaise > 0 && (
            <details>
              <summary>Waive the balance</summary>
              <ActionForm
                action={waiveBalance.bind(null, b.reference)}
                label="Waive balance"
                variant="danger"
              >
                <label>
                  Reason
                  <input name="reason" required placeholder="e.g. complimentary pilot trip" />
                </label>
              </ActionForm>
            </details>
          )}
          <RefundsBlock
            reference={b.reference}
            refunds={b.refunds}
            canHandle={canConfirmPay}
            myId={myId}
          />
        </section>
      </div>

      <ChangesPanel
        reference={b.reference}
        bookingState={b.state}
        currentTotalPaise={b.quote?.totalPaise ?? 0}
        currentStartDate={b.startDate}
        travellerCount={b.travellers.length}
        receivedPaise={b.payment.items
          .filter((p) => p.state === 'SUCCESS' || p.state === 'PARTIALLY_REFUNDED')
          .reduce((n, p) => n + p.capturedPaise - p.refundedPaise, 0)}
        changes={b.changeRequests}
        cancellations={b.cancellations}
        isOps={isOps}
        isManager={isManager}
      />

      <section className="card">
        <h2>History</h2>
        <table className="history">
          <tbody>
            {b.history.map((h, i) => (
              <tr key={i}>
                <td className="muted small">{formatDateTime(h.recordedAt)}</td>
                <td>
                  {MACHINE_LABELS[h.machine] ?? h.machine}{' '}
                  {h.from ? `${humanize(h.from)} → ` : 'created as '}
                  {humanize(h.to)}
                  {h.reason && <div className="muted small">{h.reason}</div>}
                </td>
                <td className="muted small">{humanize(h.actorRole)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
