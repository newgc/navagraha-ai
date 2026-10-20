import Link from 'next/link';

// Positioning and primary CTA per D-03 (closed). Final copy comes from the Figma content spec.
export default function Home() {
  return (
    <main>
      <h1>Your AI Pilgrimage Manager</h1>
      <p>AI plans it. Local experts execute it.</p>
      <p>
        A feasible, transparent Navagraha pilgrimage — the nine temples around Kumbakonam — with
        minimal decisions on your part.
      </p>
      <Link className="cta" href="/plan">
        Plan My Pilgrimage
      </Link>
    </main>
  );
}
