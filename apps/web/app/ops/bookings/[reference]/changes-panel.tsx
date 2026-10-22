import { STAFF_ACCEPTANCE_CHANNELS, CHANGE_KINDS, SOURCE_CHANNELS } from '@navagraha/domain';
import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { Badge } from '@/components/badge';
import { PAYMENT_METHODS, formatDate, formatRupees, humanize, todayIso } from '@/lib/format';
import {
  approveCancellation,
  approveChange,
  approveGatewayRefund,
  checkGatewayRefund,
  confirmRefund,
  recordRefund,
  rejectCancellation,
  rejectChange,
  rejectRefund,
  requestCancellation,
  requestGatewayRefund,
  sendGatewayRefund,
  requestChange,
  reviewCancellation,
  withdrawChange,
} from './actions';

export interface ChangeRequest {
  id: string;
  state: string;
  kind: string;
  description: string;
  requestedVia: string;
  decisionReason: string | null;
  proposal: {
    trip: { startDate: string; template: string; mode: string };
    travellers: { id: string }[];
    quote: { totalPaise: number; validUntil: string; state: string };
    stops: { seq: number; day: number; templeName: string }[];
  } | null;
}

export interface Cancellation {
  id: string;
  state: string;
  reason: string;
  refundPaise: number | null;
  refundNote: string | null;
  decisionReason: string | null;
}

export interface Refunds {
  duePaise: number;
  /** The payment gateway refunds go through, e.g. "Razorpay" (null without one). */
  gatewayName: string | null;
  /** The most one refund through the gateway can return (0 without an online payment). */
  gatewayRefundablePaise: number;
  items: {
    id: string;
    state: string;
    method: string;
    amountPaise: number;
    reference: string | null;
    paidOn: string | null;
    initiatedBy: string | null;
    reason: string | null;
    gateway: {
      paymentId: string;
      approvedBy: string | null;
      approvedAt: string | null;
      sentAt: string | null;
      status: string | null;
      refundId: string;
    } | null;
  }[];
}

const OPEN_CHANGE = ['REQUESTED', 'REVIEWING', 'APPROVED'];
const OPEN_CANCEL = ['REQUESTED', 'REVIEWING', 'APPROVED', 'REFUND_PENDING'];

function Via({ name = 'requestedVia', choices = SOURCE_CHANNELS as readonly string[] }) {
  return (
    <label>
      Via
      <select name={name} defaultValue="PHONE">
        {choices.map((c) => (
          <option key={c} value={c}>
            {humanize(c)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Change requests and cancellation (D-04 §4.4, §4.5). */
export function ChangesPanel(props: {
  reference: string;
  bookingState: string;
  currentTotalPaise: number;
  currentStartDate: string;
  travellerCount: number;
  receivedPaise: number;
  changes: ChangeRequest[];
  cancellations: Cancellation[];
  isOps: boolean;
  isManager: boolean;
}) {
  const { reference: ref, isOps, isManager } = props;
  const openChange = props.changes.find((c) => OPEN_CHANGE.includes(c.state));
  const openCancel = props.cancellations.find((c) => OPEN_CANCEL.includes(c.state));
  const changeable = ['PENDING_CONFIRMATION', 'CONFIRMED'].includes(props.bookingState);
  const cancellable = ['REQUESTED', 'PENDING_CONFIRMATION', 'CONFIRMED'].includes(
    props.bookingState,
  );
  const past = [
    ...props.changes.filter((c) => c !== openChange),
    ...props.cancellations.filter((c) => c !== openCancel),
  ];

  return (
    <section className="card">
      <h2>Changes and cancellation</h2>

      {openChange && (
        <div className="subcard">
          <h3>
            Change request <Badge state={openChange.state} />
          </h3>
          <p>
            {humanize(openChange.kind)}: {openChange.description}{' '}
            <span className="muted small">
              (via {humanize(openChange.requestedVia).toLowerCase()})
            </span>
          </p>
          {openChange.proposal ? (
            <div className="proposal">
              <p>
                <strong>Proposal:</strong> {formatDate(openChange.proposal.trip.startDate)}
                {openChange.proposal.trip.startDate !== props.currentStartDate && (
                  <span className="badge warn">New date</span>
                )}{' '}
                · {openChange.proposal.trip.template === '2D1N' ? '2 days / 1 night' : '1 day'} ·{' '}
                {humanize(openChange.proposal.trip.mode)} · {openChange.proposal.travellers.length}{' '}
                travellers
                {openChange.proposal.travellers.length !== props.travellerCount && (
                  <span className="badge warn">Group changed</span>
                )}
              </p>
              <p className="small">
                {openChange.proposal.stops.map((s) => s.templeName).join(' → ')}
              </p>
              <p>
                New total <strong>{formatRupees(openChange.proposal.quote.totalPaise)}</strong> (now{' '}
                {formatRupees(props.currentTotalPaise)},{' '}
                {openChange.proposal.quote.totalPaise >= props.currentTotalPaise
                  ? 'customer pays '
                  : 'refund of '}
                {formatRupees(
                  Math.abs(openChange.proposal.quote.totalPaise - props.currentTotalPaise),
                )}
                )
                <span className="muted small">
                  {' '}
                  · valid until {formatDate(openChange.proposal.quote.validUntil)}
                </span>
              </p>
            </div>
          ) : (
            <p className="muted">No proposal yet.</p>
          )}
          {isOps && (openChange.state === 'REQUESTED' || openChange.state === 'REVIEWING') && (
            <div className="row">
              <Link className="button-link" href={`/ops/bookings/${ref}/change/${openChange.id}`}>
                {openChange.proposal ? 'Edit proposal' : 'Prepare proposal'}
              </Link>
              {openChange.proposal && (
                <ActionForm
                  action={approveChange.bind(null, ref, openChange.id)}
                  label="Customer accepted — apply change"
                  inline
                >
                  <Via name="acceptedVia" choices={STAFF_ACCEPTANCE_CHANNELS} />
                </ActionForm>
              )}
              <ActionForm
                action={rejectChange.bind(null, ref, openChange.id)}
                label="Can’t do it"
                variant="danger"
                inline
              >
                <input
                  name="reason"
                  placeholder="Why"
                  required
                  aria-label="Why the change can't be done"
                />
              </ActionForm>
              <ActionForm
                action={withdrawChange.bind(null, ref, openChange.id)}
                label="Customer withdrew"
                variant="secondary"
                inline
              />
            </div>
          )}
        </div>
      )}

      {openCancel && (
        <div className="subcard">
          <h3>
            Cancellation <Badge state={openCancel.state} />
          </h3>
          <p>{openCancel.reason}</p>
          {openCancel.refundPaise != null && (
            <p>
              Refund: <strong>{formatRupees(openCancel.refundPaise)}</strong>
              {openCancel.refundNote && (
                <span className="muted small"> · {openCancel.refundNote}</span>
              )}
            </p>
          )}
          {isOps && (openCancel.state === 'REQUESTED' || openCancel.state === 'REVIEWING') && (
            <ActionForm
              action={reviewCancellation.bind(null, ref, openCancel.id)}
              label={openCancel.refundPaise == null ? 'Propose refund' : 'Update refund'}
              inline
            >
              <input
                name="refund"
                inputMode="decimal"
                required
                placeholder="Refund ₹"
                aria-label="Refund (₹)"
                defaultValue={
                  openCancel.refundPaise != null ? String(openCancel.refundPaise / 100) : ''
                }
              />
              <input
                name="refundNote"
                required
                placeholder="How it was worked out"
                aria-label="Refund note"
                defaultValue={openCancel.refundNote ?? ''}
              />
            </ActionForm>
          )}
          {isOps && openCancel.state === 'REQUESTED' && (
            <p className="muted small">
              Money received so far: {formatRupees(props.receivedPaise)}. Refund rules are not set
              yet (D-06), so propose the amount and explain it.
            </p>
          )}
          {isManager && openCancel.state === 'REVIEWING' && (
            <div className="row">
              <ActionForm
                action={approveCancellation.bind(null, ref, openCancel.id)}
                label="Approve cancellation"
                variant="danger"
                inline
              />
              <ActionForm
                action={rejectCancellation.bind(null, ref, openCancel.id)}
                label="Keep the booking"
                variant="secondary"
                inline
              >
                <input
                  name="reason"
                  placeholder="Why"
                  required
                  aria-label="Why the cancellation is rejected"
                />
              </ActionForm>
            </div>
          )}
          {!isManager && openCancel.state === 'REVIEWING' && (
            <p className="muted small">Waiting for an operations manager to approve.</p>
          )}
        </div>
      )}

      {isOps && changeable && !openChange && !openCancel && (
        <details>
          <summary>Record a change the customer asked for</summary>
          <ActionForm action={requestChange.bind(null, ref)} label="Record change request">
            <label>
              What kind
              <select name="kind" defaultValue="DATE">
                {CHANGE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {humanize(k)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              What they asked for
              <textarea name="description" required rows={2} />
            </label>
            <Via />
          </ActionForm>
        </details>
      )}
      {isOps && cancellable && !openCancel && (
        <details>
          <summary>Record a cancellation request</summary>
          <ActionForm
            action={requestCancellation.bind(null, ref)}
            label="Record cancellation request"
            variant="danger"
          >
            <label>
              Reason
              <textarea name="reason" required rows={2} />
            </label>
            <Via />
          </ActionForm>
        </details>
      )}
      {!openChange &&
        !openCancel &&
        past.length === 0 &&
        !(isOps && (changeable || cancellable)) && <p className="muted">Nothing here.</p>}

      {past.length > 0 && (
        <ul className="plain small">
          {past.map((x) => (
            <li key={x.id}>
              <Badge state={x.state} />{' '}
              {'kind' in x
                ? `Change (${humanize(x.kind).toLowerCase()}): ${x.description}`
                : `Cancellation: ${x.reason}`}
              {x.decisionReason && <span className="muted"> — {x.decisionReason}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Refunds paid out, with the two-person rule (D-19 extension). */
export function RefundsBlock({
  reference,
  refunds,
  canHandle,
  myId,
}: {
  reference: string;
  refunds: Refunds;
  canHandle: boolean;
  myId: string | null;
}) {
  if (refunds.items.length === 0 && refunds.duePaise === 0) return null;
  const gw = refunds.gatewayName ?? 'the payment gateway';
  return (
    <div className="refunds">
      <h3>Refunds</h3>
      {refunds.duePaise > 0 && (
        <p>
          <strong>Refund due {formatRupees(refunds.duePaise)}</strong>
        </p>
      )}
      <ul className="plain">
        {refunds.items.map((r) => (
          <li key={r.id} className="payment">
            {formatRupees(r.amountPaise)} ·{' '}
            {r.gateway ? `Through ${gw}` : (PAYMENT_METHODS[r.method] ?? humanize(r.method))}
            {r.reference && ` · ${r.reference}`}{' '}
            {r.paidOn && <span className="muted small">paid {formatDate(r.paidOn)}</span>}{' '}
            <Badge state={r.state} />
            {r.reason && <div className="muted small">{r.reason}</div>}
            {r.gateway && r.state === 'INITIATED' && (
              <GatewayRefundStatus
                reference={reference}
                refund={r}
                canHandle={canHandle}
                myId={myId}
                gw={gw}
              />
            )}
            {!r.gateway && r.state === 'INITIATED' && canHandle && r.initiatedBy !== myId && (
              <div className="row">
                <ActionForm
                  action={confirmRefund.bind(null, reference, r.id)}
                  label="Confirm refund sent"
                  inline
                />
                <ActionForm
                  action={rejectRefund.bind(null, reference, r.id)}
                  label="Reject"
                  variant="danger"
                  inline
                >
                  <input
                    name="reason"
                    placeholder="Why"
                    required
                    aria-label="Refund reject reason"
                  />
                </ActionForm>
              </div>
            )}
            {!r.gateway && r.state === 'INITIATED' && r.initiatedBy === myId && (
              <p className="muted small">
                You recorded this — someone else in Finance or a manager must confirm it (D-19).
              </p>
            )}
          </li>
        ))}
      </ul>
      {canHandle && refunds.duePaise > 0 && refunds.gatewayRefundablePaise > 0 && (
        <details>
          <summary>Refund through {gw}</summary>
          <p className="muted small">
            Sends the money back to the customer&apos;s online payment. Someone else in Finance or a
            manager approves it before anything is sent; it is marked refunded when {gw}
            confirms.
          </p>
          <ActionForm action={requestGatewayRefund.bind(null, reference)} label="Ask for refund">
            <label>
              Amount (₹)
              <input
                name="amount"
                inputMode="decimal"
                required
                defaultValue={Math.min(refunds.duePaise, refunds.gatewayRefundablePaise) / 100}
              />
            </label>
            <label>
              Reason (shown to {gw})
              <input name="reason" required placeholder="e.g. cancelled more than 7 days before" />
            </label>
          </ActionForm>
        </details>
      )}
      {canHandle && refunds.duePaise > 0 && (
        <details>
          <summary>Record a refund paid outside {gw}</summary>
          <ActionForm action={recordRefund.bind(null, reference)} label="Record refund">
            <label>
              Method
              <select name="method" defaultValue="OFFLINE_UPI">
                <option value="OFFLINE_UPI">UPI</option>
                <option value="OFFLINE_BANK_TRANSFER">Bank transfer</option>
                <option value="CASH">Cash</option>
              </select>
            </label>
            <label>
              Amount refunded (₹)
              <input
                name="amount"
                inputMode="decimal"
                required
                placeholder={String(refunds.duePaise / 100)}
              />
            </label>
            <label>
              Refund UPI / bank reference
              <input name="reference" required />
            </label>
            <label>
              Paid on
              <input
                name="paidOn"
                type="date"
                required
                defaultValue={todayIso()}
                max={todayIso()}
              />
            </label>
          </ActionForm>
        </details>
      )}
    </div>
  );
}

function GatewayRefundStatus({
  reference,
  refund: r,
  canHandle,
  myId,
  gw,
}: {
  reference: string;
  refund: Refunds['items'][number];
  canHandle: boolean;
  myId: string | null;
  gw: string;
}) {
  const g = r.gateway!;
  if (!g.approvedBy) {
    return r.initiatedBy === myId ? (
      <p className="muted small">
        You asked for this — someone else in Finance or a manager must approve it (D-19).
      </p>
    ) : (
      <div>
        <p className="muted small">Waiting for a second person to approve. Nothing is sent yet.</p>
        {canHandle && (
          <div className="row">
            <ActionForm
              action={approveGatewayRefund.bind(null, reference, r.id)}
              label={`Approve and send to ${gw}`}
              inline
            />
            <ActionForm
              action={rejectRefund.bind(null, reference, r.id)}
              label="Reject"
              variant="danger"
              inline
            >
              <input name="reason" placeholder="Why" required aria-label="Refund reject reason" />
            </ActionForm>
          </div>
        )}
      </div>
    );
  }
  if (!g.sentAt) {
    return (
      <div>
        <p className="muted small">Approved, but {gw} could not be reached. Send it again.</p>
        {canHandle && (
          <ActionForm
            action={sendGatewayRefund.bind(null, reference, r.id)}
            label="Send again"
            variant="secondary"
            inline
          />
        )}
      </div>
    );
  }
  return (
    <div>
      <p className="muted small">
        Sent to {gw} ({humanize(g.status)}). It is marked refunded when {gw} confirms; bank refunds
        can take a few working days.
      </p>
      {canHandle && (
        <ActionForm
          action={checkGatewayRefund.bind(null, reference, r.id)}
          label="Check refund status"
          variant="secondary"
          inline
        />
      )}
    </div>
  );
}
