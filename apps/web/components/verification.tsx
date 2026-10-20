import { formatDate } from '@/lib/format';
import { Badge } from './badge';

/** Status, last-verified date and source for one operational fact (NAV-TEM-003). */
export function Verification({
  status,
  verifiedOn,
  source,
  stale,
}: {
  status: string;
  verifiedOn?: string | null;
  source?: string | null;
  stale?: boolean;
}) {
  return (
    <span>
      <Badge state={status === 'VERIFIED' ? 'VERIFIED' : status} />
      {verifiedOn && <span className="muted small"> {formatDate(verifiedOn)}</span>}
      {stale && <span className="badge warn">Re-check due</span>}
      {source && <div className="muted small">{source}</div>}
    </span>
  );
}
