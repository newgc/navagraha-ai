import { SignInForm } from './sign-in-form';

export const metadata = { title: 'Sign in — Navagraha AI' };

export default function SignInPage() {
  return (
    <main className="narrow">
      <h1>Sign in</h1>
      <SignInForm />
    </main>
  );
}
