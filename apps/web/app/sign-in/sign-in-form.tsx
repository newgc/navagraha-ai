'use client';

import { useActionState } from 'react';
import { requestCode, verifyCode, type SignInState } from './actions';

export function SignInForm() {
  const [phoneState, sendCode, sending] = useActionState(requestCode, {
    step: 'phone',
  } as SignInState);
  const [codeState, checkCode, checking] = useActionState(verifyCode, {
    step: 'code',
  } as SignInState);
  const onCodeStep = phoneState.step === 'code' && codeState.step !== 'phone';
  const error = onCodeStep ? codeState.error : (phoneState.error ?? codeState.error);

  if (!onCodeStep) {
    return (
      <form action={sendCode} className="stack">
        <label>
          Mobile number
          <input
            name="phone"
            type="tel"
            autoComplete="tel"
            required
            defaultValue={phoneState.phone}
            placeholder="98765 43210"
          />
        </label>
        <button type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Send code'}
        </button>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </form>
    );
  }
  return (
    <form action={checkCode} className="stack">
      <p>We sent a 6-digit code to {phoneState.phone}.</p>
      <label>
        Code
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
        />
      </label>
      <button type="submit" disabled={checking}>
        {checking ? 'Checking…' : 'Sign in'}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
