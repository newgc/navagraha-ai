import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Verification } from '@/components/verification';
import { api, errorText } from '@/lib/api';
import { formatDate, formatRupees, humanize } from '@/lib/format';

interface Prov {
  verificationStatus: string;
  verifiedOn: string | null;
  source: string | null;
  stale: boolean;
  notes?: string | null;
}

interface Detail {
  temple: Prov & {
    code: string;
    commonName: string;
    officialName: string | null;
    graha: string | null;
    mainDeity: string | null;
    town: string | null;
    district: string | null;
    state: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    mapsUrl: string | null;
    officePhone: string | null;
    walkFromParkingMetres: number | null;
    stepsToClimb: string | null;
    wheelchairAccess: boolean | null;
    seatingAvailable: boolean | null;
    toiletsNearby: boolean | null;
    visitMinutesNormal: number | null;
    visitMinutesBusy: number | null;
    parkingNotes: string | null;
    seniorNotes: string | null;
  };
  schedules: (Prov & {
    id: string;
    dayType: string;
    session: string;
    opensAt: string;
    closesAt: string;
    lastEntryAt: string | null;
    validFrom: string;
    validTo: string | null;
  })[];
  specialDays: (Prov & {
    id: string;
    name: string;
    kind: string;
    fromDate: string;
    toDate: string;
    effect: string;
  })[];
  services: (Prov & {
    id: string;
    code: string;
    name: string;
    kind: string;
    timeWindow: string | null;
    templeFeePaise: number | null;
    feeBasis: string | null;
    active: boolean;
  })[];
  entryRules: (Prov & { id: string; category: string; rule: string; costPaise: number | null })[];
  travel: (Omit<Prov, 'notes'> & {
    other?: { code: string; name: string };
    direction: string;
    symmetric: boolean;
    distanceKm: number | null;
    normalMinutes: number | null;
    peakMinutes: number | null;
    roadNotes: string | null;
  })[];
}

const yn = (v: boolean | null) => (v == null ? 'Unknown' : v ? 'Yes' : 'No');
const hm = (t: string | null) => (t ? t.slice(0, 5) : '—');

function Empty({ what }: { what: string }) {
  return <p className="muted">No {what} in the workbook yet.</p>;
}

export default async function TemplePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const r = await api<Detail>(`/admin/temple-data/temples/${encodeURIComponent(code)}`);
  if (!r.ok && (r.status === 404 || r.status === 400)) notFound();
  if (!r.ok)
    return (
      <p role="alert" className="error">
        {errorText(r.error)}
      </p>
    );
  const { temple: t, schedules, specialDays, services, entryRules, travel } = r.data;

  return (
    <>
      <p className="small">
        <Link href="/ops/temples">← Temple data</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{t.commonName}</h1>
          <p className="muted">
            {t.graha} · {t.officialName ?? 'official name not recorded'} · {t.town}, {t.state}
          </p>
          <p className="small">
            <Link href={`/ops/temples/queue?view=all&temple=${t.code}`}>
              Sources and second checks for this temple
            </Link>
          </p>
        </div>
        <Verification
          status={t.verificationStatus}
          verifiedOn={t.verifiedOn}
          source={t.source}
          stale={t.stale}
        />
      </div>

      <div className="grid">
        <section className="card">
          <h2>Record</h2>
          <dl className="facts">
            <dt>Main deity</dt>
            <dd>{t.mainDeity ?? '—'}</dd>
            <dt>Address</dt>
            <dd>{t.address ?? '—'}</dd>
            <dt>Location</dt>
            <dd>
              {t.latitude != null ? `${t.latitude}, ${t.longitude}` : '—'}
              {t.mapsUrl && (
                <>
                  {' · '}
                  <a href={t.mapsUrl} rel="noreferrer noopener" target="_blank">
                    Map
                  </a>
                </>
              )}
            </dd>
            <dt>Temple office</dt>
            <dd>{t.officePhone ?? '—'}</dd>
            <dt>Typical visit</dt>
            <dd>
              {t.visitMinutesNormal ? `${t.visitMinutesNormal} min` : '—'}
              {t.visitMinutesBusy ? ` (busy day ${t.visitMinutesBusy} min)` : ''}
            </dd>
            <dt>Notes</dt>
            <dd>{t.notes ?? '—'}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>Access (Senior-Friendly planning)</h2>
          <dl className="facts">
            <dt>Walk from parking</dt>
            <dd>{t.walkFromParkingMetres != null ? `${t.walkFromParkingMetres} m` : '—'}</dd>
            <dt>Steps</dt>
            <dd>{t.stepsToClimb ?? '—'}</dd>
            <dt>Wheelchair access</dt>
            <dd>{yn(t.wheelchairAccess)}</dd>
            <dt>Seating</dt>
            <dd>{yn(t.seatingAvailable)}</dd>
            <dt>Toilets nearby</dt>
            <dd>{yn(t.toiletsNearby)}</dd>
            <dt>Parking</dt>
            <dd>{t.parkingNotes ?? '—'}</dd>
            <dt>For seniors</dt>
            <dd>{t.seniorNotes ?? '—'}</dd>
          </dl>
        </section>
      </div>

      <section className="card">
        <h2>Opening hours</h2>
        {schedules.length === 0 ? (
          <Empty what="opening hours" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Days</th>
                <th>Session</th>
                <th>Open</th>
                <th>Valid</th>
                <th>Verification</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td>{s.dayType}</td>
                  <td>{s.session}</td>
                  <td>
                    {hm(s.opensAt)}–{hm(s.closesAt)}
                    {s.lastEntryAt && (
                      <div className="muted small">last entry {hm(s.lastEntryAt)}</div>
                    )}
                  </td>
                  <td className="small">
                    from {formatDate(s.validFrom)}
                    {s.validTo && ` to ${formatDate(s.validTo)}`}
                  </td>
                  <td>
                    <Verification
                      status={s.verificationStatus}
                      verifiedOn={s.verifiedOn}
                      source={s.source}
                      stale={s.stale}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Special days</h2>
        {specialDays.length === 0 ? (
          <Empty what="festivals or closures" />
        ) : (
          <table>
            <tbody>
              {specialDays.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    <div className="muted small">{s.kind}</div>
                  </td>
                  <td className="small">
                    {formatDate(s.fromDate)}
                    {s.toDate !== s.fromDate && ` – ${formatDate(s.toDate)}`}
                  </td>
                  <td>{s.effect}</td>
                  <td>
                    <Verification
                      status={s.verificationStatus}
                      verifiedOn={s.verifiedOn}
                      source={s.source}
                      stale={s.stale}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Services (pooja / pariharam)</h2>
        {services.length === 0 ? (
          <Empty what="services" />
        ) : (
          <table>
            <tbody>
              {services.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    <div className="muted small">
                      {s.code} · {s.kind}
                      {s.timeWindow && ` · ${s.timeWindow}`}
                    </div>
                  </td>
                  <td className="num">
                    {formatRupees(s.templeFeePaise)}
                    {s.feeBasis && <div className="muted small">{s.feeBasis.toLowerCase()}</div>}
                  </td>
                  <td>
                    {s.active ? (
                      <span className="badge good">Offered</span>
                    ) : (
                      <span className="badge neutral">Not offered</span>
                    )}
                  </td>
                  <td>
                    <Verification
                      status={s.verificationStatus}
                      verifiedOn={s.verifiedOn}
                      source={s.source}
                      stale={s.stale}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid">
        <section className="card">
          <h2>Travel times</h2>
          {travel.length === 0 ? (
            <Empty what="travel times" />
          ) : (
            <table>
              <tbody>
                {travel.map((x, i) => (
                  <tr key={i}>
                    <td>
                      {x.symmetric ? '↔' : x.direction === 'from' ? 'To' : 'From'} {x.other?.name}
                      {x.roadNotes && <div className="muted small">{x.roadNotes}</div>}
                    </td>
                    <td className="small">
                      {x.normalMinutes ? `${x.normalMinutes} min` : '—'}
                      {x.peakMinutes ? ` (peak ${x.peakMinutes})` : ''}
                      {x.distanceKm ? ` · ${x.distanceKm} km` : ''}
                    </td>
                    <td>
                      <Verification
                        status={x.verificationStatus}
                        verifiedOn={x.verifiedOn}
                        stale={x.stale}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2>Entry rules</h2>
          {entryRules.length === 0 ? (
            <Empty what="entry rules for this temple" />
          ) : (
            <table>
              <tbody>
                {entryRules.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.rule}
                      <div className="muted small">
                        {humanize(e.category)}
                        {e.costPaise != null && ` · ${formatRupees(e.costPaise)}`}
                      </div>
                    </td>
                    <td>
                      <Verification
                        status={e.verificationStatus}
                        verifiedOn={e.verifiedOn}
                        source={e.source}
                        stale={e.stale}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
