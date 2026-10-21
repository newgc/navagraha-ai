import { ActionForm } from '@/components/action-form';
import { api, errorText, type Me } from '@/lib/api';
import { humanize } from '@/lib/format';
import { changeRole } from './actions';

export const metadata = { title: 'Team — Navagraha AI' };

interface Team {
  roles: string[];
  members: { id: string; phone: string | null; displayName: string | null; roles: string[] }[];
}

const ABOUT: Record<string, string> = {
  OPS_COORDINATOR: 'Takes bookings, confirms suppliers, records payments received',
  OPS_MANAGER: 'Everything a coordinator does, plus approvals, cancellations and waivers',
  FINANCE: 'Confirms payments and refunds (the second person, D-19)',
  CONTENT_ADMIN: 'Uploads the temple data workbook',
  SYSTEM_ADMIN: 'Manages this team list',
  DRIVER: 'Reserved for the driver screens (not used yet)',
};

/** Who has which staff role (MR-36). System Admins only; every change is audited. */
export default async function TeamPage() {
  const [r, me] = await Promise.all([api<Team>('/admin/team'), api<Me>('/me')]);
  if (!r.ok)
    return (
      <p role="alert" className="error">
        {errorText(r.error)}
      </p>
    );
  const myId = me.ok ? me.data.id : null;

  return (
    <>
      <h1>Team</h1>
      <p className="muted">
        People sign in with their own mobile number. Give a role here first; it applies from their
        next click.
      </p>

      <section className="card">
        <h2>Add a person or give another role</h2>
        <ActionForm action={changeRole} label="Give role">
          <input type="hidden" name="action" value="grant" />
          <div className="row">
            <label>
              Mobile number
              <input name="phone" type="tel" required placeholder="98765 43210" />
            </label>
            <label>
              Name
              <input name="name" placeholder="Shown in the console" />
            </label>
            <label>
              Role
              <select name="role" defaultValue="OPS_COORDINATOR">
                {r.data.roles.map((role) => (
                  <option key={role} value={role}>
                    {humanize(role)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </ActionForm>
        <ul className="plain small muted">
          {r.data.roles.map((role) => (
            <li key={role}>
              <strong>{humanize(role)}</strong> — {ABOUT[role]}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Team members</h2>
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Roles</th>
            </tr>
          </thead>
          <tbody>
            {r.data.members.map((m) => (
              <tr key={m.id}>
                <td>
                  {m.displayName ?? '—'}
                  {m.id === myId && <span className="badge neutral">You</span>}
                  <div className="muted small">{m.phone}</div>
                </td>
                <td>
                  {m.roles.map((role) => (
                    <span key={role} className="role-chip">
                      {humanize(role)}
                      {!(role === 'SYSTEM_ADMIN' && m.id === myId) && (
                        <ActionForm action={changeRole} label="Remove" variant="secondary" inline>
                          <input type="hidden" name="action" value="revoke" />
                          <input type="hidden" name="role" value={role} />
                          <input type="hidden" name="phone" value={m.phone ?? ''} />
                        </ActionForm>
                      )}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
