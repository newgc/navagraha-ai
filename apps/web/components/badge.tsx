import { humanize, tone } from '@/lib/format';

export function Badge({ state }: { state: string }) {
  return <span className={`badge ${tone(state)}`}>{humanize(state)}</span>;
}
