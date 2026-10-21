/**
 * Navagraha AI emblem: Surya at the centre, the other eight grahas around it, each in its
 * traditional colour. A placeholder until a designed logo is supplied.
 */
const RING = [
  { name: 'Chandra (Moon)', colour: '#e9e4d8' },
  { name: 'Angaraka (Mars)', colour: '#c0392b' },
  { name: 'Budha (Mercury)', colour: '#2e8b57' },
  { name: 'Guru (Jupiter)', colour: '#e0a800' },
  { name: 'Shukra (Venus)', colour: '#f5f1ea' },
  { name: 'Shani (Saturn)', colour: '#2f3e5c' },
  { name: 'Rahu', colour: '#5d5d6b' },
  { name: 'Ketu', colour: '#8a6d5a' },
];

export function Emblem({ size = 40, title }: { size?: number; title?: string }) {
  const c = 50;
  const r = 34;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      className="emblem"
    >
      {title && <title>{title}</title>}
      <circle cx={c} cy={c} r={46} fill="none" stroke="var(--gold)" strokeWidth={2} />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke="var(--gold)"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      {/* Surya's rays */}
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        return (
          <line
            key={i}
            x1={c + Math.cos(a) * 16}
            y1={c + Math.sin(a) * 16}
            x2={c + Math.cos(a) * 21}
            y2={c + Math.sin(a) * 21}
            stroke="var(--saffron)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={c} cy={c} r={12} fill="var(--saffron)" />
      {RING.map((g, i) => {
        const a = (i * Math.PI) / 4 - Math.PI / 2;
        return (
          <circle
            key={g.name}
            cx={c + Math.cos(a) * r}
            cy={c + Math.sin(a) * r}
            r={6.5}
            fill={g.colour}
            stroke="var(--gold)"
            strokeWidth={1.2}
          >
            <title>{g.name}</title>
          </circle>
        );
      })}
    </svg>
  );
}
