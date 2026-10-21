import Link from 'next/link';
import { Emblem } from '@/components/emblem';
import { SitePage } from '@/components/site-header';
import { api } from '@/lib/api';

interface Temple {
  code: string;
  graha: string | null;
  commonName: string;
  town: string | null;
}

/** Each graha's traditional colour, for the temple cards. */
const COLOUR: Record<string, string> = {
  'TEM-SUR': '#f97316',
  'TEM-CHA': '#cbd5e1',
  'TEM-ANG': '#c0392b',
  'TEM-BUD': '#2e8b57',
  'TEM-GUR': '#e0a800',
  'TEM-SHU': '#e7e0d4',
  'TEM-SHA': '#2f3e5c',
  'TEM-RAH': '#6b6b7b',
  'TEM-KET': '#8a6d5a',
};

const STEPS = [
  {
    title: 'Tell us about your trip',
    text: 'Your date, who is travelling and where to pick you up. No sign-up — we confirm your number with a WhatsApp code.',
  },
  {
    title: 'We plan it for you',
    text: 'Temple order, darshan times, travel, meals and rest — worked out by our team against temple timings and travel times.',
  },
  {
    title: 'Accept and pay securely',
    text: 'See the full itinerary and price first. Pay online only when you are happy with it.',
  },
  {
    title: 'Travel with our local team',
    text: 'Your vehicle and arrangements are confirmed before you travel, and our team is your single point of contact.',
  },
];

const PROMISES = [
  {
    title: 'Senior-friendly pacing',
    text: 'Travelling with parents? Plans give more time at each temple, more rest and fewer temples a day.',
  },
  {
    title: 'Facts, not guesses',
    text: 'Timings and prices come from verified sources and our team — never made up. Anything unconfirmed is clearly marked.',
  },
  {
    title: 'One or two days',
    text: 'All nine temples in one full day, or two relaxed days with an overnight stay in Kumbakonam.',
  },
  {
    title: 'Transparent price',
    text: 'Every line of the price is shown before you book, and payments are handled securely by Cashfree.',
  },
];

function splitGraha(g: string | null) {
  const m = g?.match(/^(.*?)\s*\((.*)\)\s*$/);
  return m ? { name: m[1]!, english: m[2]! } : { name: g ?? '', english: '' };
}

export default async function Home() {
  const r = await api<{ temples: Temple[] }>('/temples');
  const temples = r.ok ? r.data.temples : [];

  return (
    <SitePage>
      <main className="home">
        <section className="hero">
          <div className="container hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">Navagraha temples · Kumbakonam, Tamil Nadu</p>
              {/* D-03: positioning and primary CTA. */}
              <h1>Your AI Pilgrimage Manager</h1>
              <p className="lead">AI plans it. Local experts execute it.</p>
              <p>
                A feasible, transparent Navagraha pilgrimage — the nine temples around Kumbakonam —
                with minimal decisions on your part.
              </p>
              <div className="hero-actions">
                <Link className="cta" href="/plan">
                  Plan My Pilgrimage
                </Link>
                <Link className="cta cta-ghost" href="#how">
                  How it works
                </Link>
              </div>
            </div>
            <div className="hero-art">
              <Emblem size={300} title="The nine grahas around Surya" />
            </div>
          </div>
        </section>

        <section id="how" className="band">
          <div className="container">
            <h2 className="section-title">How it works</h2>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="step-no" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {temples.length > 0 && (
          <section id="temples" className="band band-alt">
            <div className="container">
              <h2 className="section-title">The nine Navagraha temples</h2>
              <p className="section-lead">
                Each temple is the abode of one of the nine grahas. We plan the order, timings and
                travel between them for you.
              </p>
              <ul className="temple-grid">
                {temples.map((t) => {
                  const g = splitGraha(t.graha);
                  return (
                    <li key={t.code} className="temple-card">
                      <span
                        className="graha-dot"
                        style={{ background: COLOUR[t.code] ?? 'var(--gold)' }}
                        aria-hidden="true"
                      />
                      <div>
                        <p className="graha">
                          {g.name}
                          {g.english && <span className="muted"> · {g.english}</span>}
                        </p>
                        <h3>{t.commonName}</h3>
                        {t.town && t.town !== t.commonName && (
                          <p className="small muted">{t.town}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        )}

        <section className="band">
          <div className="container">
            <h2 className="section-title">What you can count on</h2>
            <ul className="promises">
              {PROMISES.map((p) => (
                <li key={p.title}>
                  <h3>{p.title}</h3>
                  <p>{p.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="cta-band">
          <div className="container cta-band-inner">
            <div>
              <h2>Ready to plan your Navagraha yathra?</h2>
              <p>Tell us your dates — our team sends you a plan and price on WhatsApp.</p>
            </div>
            <Link className="cta cta-light" href="/plan">
              Plan My Pilgrimage
            </Link>
          </div>
        </section>
      </main>
    </SitePage>
  );
}
