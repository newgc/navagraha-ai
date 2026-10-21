import { SitePage } from '@/components/site-header';
import { SignInForm } from './sign-in-form';

export const metadata = { title: 'Sign in — Navagraha AI' };

export default function SignInPage() {
  return (
    <SitePage>
      <main className="narrow">
        <h1>Sign in</h1>
        <p>Use your mobile number. We send you a 6-digit code on WhatsApp.</p>
        <SignInForm />
      </main>
    </SitePage>
  );
}
