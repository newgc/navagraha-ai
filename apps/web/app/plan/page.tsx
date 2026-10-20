import Link from 'next/link';

export const metadata = { title: 'Plan My Pilgrimage — Navagraha AI' };

// Placeholder until the planner is built (delivery plan phase P5).
export default function Plan() {
  return (
    <main>
      <h1>Plan My Pilgrimage</h1>
      <p>The planner is being built. For now, our team plans every pilgrimage personally.</p>
      <Link href="/">Back</Link>
    </main>
  );
}
