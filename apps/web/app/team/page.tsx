import { IgleError } from "@igle/shared";
import { runtime } from "../../lib/runtime";
import { requireActorOrRedirect } from "../../lib/session";

export default async function TeamPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; added?: string; updated?: string; removed?: string; passwordUpdated?: string; twoFactorReset?: string }>;
}) {
  const actor = await requireActorOrRedirect();
  const { error, added, updated, removed, passwordUpdated, twoFactorReset } = await searchParams;

  let members: Awaited<ReturnType<typeof runtime.authService.listTeamMembers>> = [];
  let forbidden = false;
  try {
    members = await runtime.authService.listTeamMembers(actor);
  } catch (err) {
    if (err instanceof IgleError && err.code === "FORBIDDEN") forbidden = true;
    else throw err;
  }

  const hasTeamPassword = await runtime.authService.hasTeamPassword();

  if (forbidden) {
    return (
      <>
        <div className="toolbar">
          <h1>Team</h1>
        </div>
        <article className="card">
          <p className="muted" style={{ margin: 0 }}>
            Only administrators can manage team access.
          </p>
        </article>
      </>
    );
  }

  return (
    <>
      <div className="toolbar">
        <div>
          <h1>Team</h1>
          <p className="muted">Register a teammate&apos;s email and role. Everyone signs in with their own email and the one team password.</p>
        </div>
      </div>

      {error ? (
        <article className="card" style={{ borderColor: "var(--warn)", marginBottom: 16, maxWidth: 640 }}>
          {error}
        </article>
      ) : null}
      {added ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Member registered.
        </article>
      ) : null}
      {updated ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Role updated.
        </article>
      ) : null}
      {removed ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Member removed.
        </article>
      ) : null}
      {passwordUpdated ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Team password updated — it now applies to every registered member.
        </article>
      ) : null}
      {twoFactorReset ? (
        <article className="card" style={{ borderColor: "var(--accent)", marginBottom: 16, maxWidth: 640 }}>
          Two-factor authentication reset for <strong>{twoFactorReset}</strong> — they&apos;ll set it up again on their
          next sign-in.
        </article>
      ) : null}

      <div className="settings-card" style={{ marginBottom: 24 }}>
        <div className="settings-card-header">
          <h2>Team password</h2>
        </div>
        <form method="post" action="/api/team/password">
          <div className="settings-section">
            <p className="settings-section-title">Shared login password</p>
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              {hasTeamPassword
                ? "One password gates every registered account. Changing it here updates it for the whole team immediately."
                : "Not set yet — set it before registering any members."}
            </p>
            <div className="field" style={{ maxWidth: 280 }}>
              <label htmlFor="password">{hasTeamPassword ? "New team password" : "Set team password"}</label>
              <input type="password" id="password" name="password" required minLength={8} autoComplete="new-password" />
            </div>
          </div>
          <button className="button" type="submit" style={{ justifySelf: "start", marginTop: 4 }}>
            {hasTeamPassword ? "Update password" : "Set password"}
          </button>
        </form>
      </div>

      <div className="settings-card" style={{ marginBottom: 24, maxWidth: 640 }}>
        <div className="settings-card-header">
          <h2>Register a member</h2>
        </div>
        <form method="post" action="/api/team/members" style={{ display: "grid", gap: 10 }}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input type="email" id="email" name="email" required />
            </div>
            <div className="field">
              <label htmlFor="name">Name (optional)</label>
              <input type="text" id="name" name="name" />
            </div>
          </div>
          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="role">Role</label>
            <select id="role" name="role" defaultValue="administrator">
              <option value="administrator">Administrator — full access</option>
              <option value="editor">Editor — assigned sites only</option>
            </select>
          </div>
          <button className="button" type="submit" style={{ justifySelf: "start" }} disabled={!hasTeamPassword}>
            Register member
          </button>
          {!hasTeamPassword ? <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>Set the team password above first.</p> : null}
        </form>
      </div>

      <h2>Members ({members.length})</h2>
      <div className="list">
        {members.map((member) => (
          <div key={member.id} className="list-row" style={{ flexWrap: "wrap", rowGap: 8 }}>
            <div className="main">
              <h3>{member.name}</h3>
              <p className="muted">
                {member.email}{" "}
                {member.role === "administrator" ? (
                  <span className="status" style={{ marginLeft: 6, fontSize: 11 }}>Can deploy restricted</span>
                ) : null}{" "}
                <span
                  className="badge"
                  style={{
                    marginLeft: 6,
                    background: member.twoFactorEnabled ? "var(--accent)" : "var(--warn)",
                    color: "#fff"
                  }}
                >
                  {member.twoFactorEnabled ? "2FA set up" : "2FA not set up yet"}
                </span>
              </p>
            </div>
            <form method="post" action={`/api/team/members/${member.id}/role`} style={{ display: "flex", gap: 6 }}>
              <select
                name="role"
                defaultValue={member.role}
                style={{ border: "1px solid var(--line)", borderRadius: 6, padding: "5px 8px", font: "inherit", fontSize: 12.5 }}
              >
                <option value="administrator">Administrator</option>
                <option value="editor">Editor</option>
              </select>
              <button className="button" type="submit" style={{ fontSize: 12.5, padding: "5px 10px" }}>
                Save
              </button>
            </form>
            {member.id !== actor.id && member.twoFactorEnabled ? (
              <form method="post" action={`/api/team/members/${member.id}/reset-2fa`} style={{ marginLeft: 8 }}>
                <button className="button" type="submit" style={{ background: "none", color: "var(--warn)", fontSize: 12.5, padding: "6px 10px" }}>
                  Reset 2FA
                </button>
              </form>
            ) : null}
            {member.id !== actor.id ? (
              <form method="post" action={`/api/team/members/${member.id}/remove`} style={{ marginLeft: 8 }}>
                <button className="button" type="submit" style={{ background: "none", color: "var(--warn)", fontSize: 12.5, padding: "6px 10px" }}>
                  Remove
                </button>
              </form>
            ) : (
              <span className="status" style={{ marginLeft: 8 }}>
                You
              </span>
            )}
          </div>
        ))}
        {members.length === 0 ? (
          <div className="list-row">
            <p className="muted" style={{ margin: 0 }}>No members registered yet.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
