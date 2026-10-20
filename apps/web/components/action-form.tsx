'use client';

import { useActionState, type ReactNode } from 'react';

export interface ActionState {
  error?: string;
  done?: boolean;
}

/**
 * A small form bound to a server action. Shows the action's error inline and disables the
 * button while it runs, so a double click cannot submit twice.
 */
export function ActionForm({
  action,
  label,
  children,
  variant = 'primary',
  inline = false,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  label: string;
  children?: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={inline ? 'inline-form' : 'action-form'}>
      {children}
      <button type="submit" className={variant} disabled={pending}>
        {pending ? 'Working…' : label}
      </button>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
    </form>
  );
}
