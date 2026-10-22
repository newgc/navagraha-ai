// Where the payment gateway sends the customer after paying through a link (D-11). It never records a
// payment: only the gateway's own records do (FS §11.2), so this page only says what happens next.
import Link from 'next/link';
import { SitePage } from '@/components/site-header';

export const metadata = { title: 'Thank you — Navagraha AI' };

export default function Paid() {
  return (
    <SitePage>
      <main className="narrow">
        <h1>Thank you</h1>
        <p>
          If your payment went through, you will see it on your booking within a few minutes. We
          confirm your pilgrimage once the payment is received and every arrangement is in place,
          and we will message you on WhatsApp.
        </p>
        <p className="small muted">
          If the payment did not complete, you can open the same link again before it expires.
        </p>
        <p>
          <Link href="/trips">See my trips</Link>
        </p>
      </main>
    </SitePage>
  );
}
