import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { assertCan, IgleError, type Actor } from "@igle/shared";
import { JsonStateStore, id } from "./state-store.js";
import type { UserRecord } from "./types.js";

export interface TeamMemberSummary {
  id: string;
  email: string;
  name: string;
  role: "administrator" | "editor";
  canDeployRestricted: boolean;
  createdAt: string;
  lockedUntil?: string | undefined;
}

export class AuthService {
  constructor(private readonly stateStore: JsonStateStore) {}

  /**
   * One shared password gates every registered account (SOT: "one password for everyone" — the
   * team is small and trusted; per-user passwords/invite links were judged unnecessary overhead).
   * Bootstraps the very first administrator when no users exist yet — called at server startup
   * from ADMIN_EMAIL/ADMIN_PASSWORD env vars, never from a request (no actor exists yet to check).
   */
  async bootstrapFirstAdminIfNeeded(email: string, password: string): Promise<UserRecord | undefined> {
    const state = await this.stateStore.read();
    if (state.users.length > 0) return undefined;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = this.createUserRecordWithHash(email, passwordHash, email, "administrator");
    user.canDeployRestricted = true;
    state.users.push(user);
    state.teamPasswordHash = passwordHash;
    state.teamPasswordUpdatedAt = new Date().toISOString();
    await this.stateStore.write(state);
    return user;
  }

  async hasTeamPassword(): Promise<boolean> {
    const state = await this.stateStore.read();
    return Boolean(state.teamPasswordHash);
  }

  /** Admin-only. Re-hashes and applies the new shared password to every existing account too, so it stays one password for everyone going forward. */
  async setTeamPassword(newPassword: string, actor: Actor): Promise<void> {
    assertCan(actor, "users.manage");
    if (newPassword.length < 8) throw new IgleError("VALIDATION_ERROR", "Password must be at least 8 characters.", 400);
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.stateStore.update((state) => {
      state.teamPasswordHash = passwordHash;
      state.teamPasswordUpdatedAt = new Date().toISOString();
      for (const user of state.users) user.passwordHash = passwordHash;
    });
  }

  async listTeamMembers(actor: Actor): Promise<TeamMemberSummary[]> {
    assertCan(actor, "users.manage");
    const state = await this.stateStore.read();
    return state.users
      .map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        canDeployRestricted: user.canDeployRestricted,
        createdAt: user.createdAt,
        lockedUntil: user.lockedUntil
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  async addTeamMember(input: { email: string; name?: string; role: "administrator" | "editor" }, actor: Actor): Promise<UserRecord> {
    assertCan(actor, "users.manage");
    const state = await this.stateStore.read();
    if (!state.teamPasswordHash) {
      throw new IgleError("TEAM_PASSWORD_NOT_SET", "Set a team password before registering members.", 400);
    }
    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes("@")) throw new IgleError("VALIDATION_ERROR", "Enter a valid email address.", 400);
    if (state.users.some((user) => user.email.toLowerCase() === email)) {
      throw new IgleError("USER_EXISTS", "A member with this email is already registered.", 409);
    }
    const user = this.createUserRecordWithHash(email, state.teamPasswordHash, input.name?.trim() || email, input.role);
    state.users.push(user);
    await this.stateStore.write(state);
    return user;
  }

  async updateTeamMemberRole(userId: string, role: "administrator" | "editor", actor: Actor): Promise<void> {
    assertCan(actor, "users.manage");
    await this.stateStore.update((state) => {
      const user = state.users.find((item) => item.id === userId);
      if (!user) throw new IgleError("USER_NOT_FOUND", "Member was not found.", 404);
      user.role = role;
    });
  }

  /** Admin-only. Grants/revokes the specific "can deploy to restricted servers" flag — independent of role. */
  async setCanDeployRestricted(userId: string, value: boolean, actor: Actor): Promise<void> {
    assertCan(actor, "users.manage");
    await this.stateStore.update((state) => {
      const user = state.users.find((item) => item.id === userId);
      if (!user) throw new IgleError("USER_NOT_FOUND", "Member was not found.", 404);
      user.canDeployRestricted = value;
    });
  }

  async removeTeamMember(userId: string, actor: Actor): Promise<void> {
    assertCan(actor, "users.manage");
    if (userId === actor.id) throw new IgleError("CANNOT_REMOVE_SELF", "You can't remove your own account.", 400);
    await this.stateStore.update((state) => {
      state.users = state.users.filter((user) => user.id !== userId);
      state.sessions = state.sessions.filter((session) => session.userId !== userId);
    });
  }

  /** Looks up the actor for a session cookie value. Returns undefined for missing/expired/revoked sessions — never throws, so callers can treat it as "not logged in." */
  async getActorForSession(sessionId: string | undefined): Promise<Actor | undefined> {
    if (!sessionId) return undefined;
    const state = await this.stateStore.read();
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session || session.revokedAt) return undefined;
    if (new Date(session.expiresAt).getTime() < Date.now()) return undefined;
    const user = state.users.find((item) => item.id === session.userId);
    if (!user) return undefined;
    return { id: user.id, email: user.email, role: user.role, canDeployRestricted: user.canDeployRestricted };
  }

  async logout(sessionId: string): Promise<void> {
    await this.stateStore.update((state) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (session) session.revokedAt = new Date().toISOString();
    });
  }

  async createFirstAdministrator(input: { email: string; password: string; name?: string }): Promise<UserRecord> {
    const state = await this.stateStore.read();
    if (state.users.length > 0) {
      throw new IgleError("SETUP_ALREADY_COMPLETE", "The first administrator already exists.", 409);
    }
    const user = await this.createUserRecord(input.email, input.password, input.name ?? input.email, "administrator");
    state.users.push(user);
    await this.stateStore.write(state);
    return user;
  }

  async inviteUser(input: { email: string; role: "administrator" | "editor"; expiresHours?: number }): Promise<{ inviteId: string; token: string; expiresAt: string }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + (input.expiresHours ?? 72) * 60 * 60 * 1000).toISOString();
    const inviteId = id("invite");
    await this.stateStore.update((state) => {
      state.invites.push({
        id: inviteId,
        email: input.email,
        role: input.role,
        tokenHash: hash(token),
        expiresAt
      });
    });
    return { inviteId, token, expiresAt };
  }

  async acceptInvite(input: { token: string; password: string; name?: string }): Promise<UserRecord> {
    const tokenHash = hash(input.token);
    const state = await this.stateStore.read();
    const invite = state.invites.find((item) => item.tokenHash === tokenHash && !item.acceptedAt);
    if (!invite) throw new IgleError("INVITE_NOT_FOUND", "Invite link is invalid.", 404);
    if (new Date(invite.expiresAt).getTime() < Date.now()) throw new IgleError("INVITE_EXPIRED", "Invite link has expired.", 410);
    const user = await this.createUserRecord(invite.email, input.password, input.name ?? invite.email, invite.role);
    invite.acceptedAt = new Date().toISOString();
    state.users.push(user);
    await this.stateStore.write(state);
    return user;
  }

  async createSession(email: string, password: string): Promise<{ sessionId: string; user: UserRecord; requiresTwoFactor: boolean }> {
    const state = await this.stateStore.read();
    const user = state.users.find((item) => item.email.toLowerCase() === email.toLowerCase());
    if (!user) throw new IgleError("INVALID_LOGIN", "Email or password is incorrect.", 401);
    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      throw new IgleError("LOGIN_LOCKED", "Too many failed attempts. Try again later.", 429);
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      await this.recordFailedLogin(user.id);
      throw new IgleError("INVALID_LOGIN", "Email or password is incorrect.", 401);
    }

    const sessionId = id("sess");
    state.sessions.push({
      id: sessionId,
      userId: user.id,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    });
    user.failedLoginCount = 0;
    user.failedLoginWindowStartedAt = undefined;
    await this.stateStore.write(state);
    return { sessionId, user, requiresTwoFactor: user.requireTwoFactor || user.twoFactorEnabled };
  }

  async enrollTotp(userId: string, secret = randomBytes(20).toString("base64url")): Promise<{ secret: string }> {
    await this.stateStore.update((state) => {
      const user = state.users.find((item) => item.id === userId);
      if (!user) throw new IgleError("USER_NOT_FOUND", "User does not exist.", 404);
      user.twoFactorSecret = secret;
      user.twoFactorEnabled = true;
    });
    return { secret };
  }

  private async createUserRecord(email: string, password: string, name: string, role: "administrator" | "editor"): Promise<UserRecord> {
    return this.createUserRecordWithHash(email, await bcrypt.hash(password, 12), name, role);
  }

  private createUserRecordWithHash(email: string, passwordHash: string, name: string, role: "administrator" | "editor"): UserRecord {
    return {
      id: id("user"),
      email,
      name,
      role,
      passwordHash,
      canDeployRestricted: false,
      twoFactorEnabled: false,
      requireTwoFactor: false,
      failedLoginCount: 0,
      createdAt: new Date().toISOString()
    };
  }

  private async recordFailedLogin(userId: string): Promise<void> {
    await this.stateStore.update((state) => {
      const user = state.users.find((item) => item.id === userId);
      if (!user) return;
      const now = Date.now();
      const windowStarted = user.failedLoginWindowStartedAt ? new Date(user.failedLoginWindowStartedAt).getTime() : 0;
      if (!windowStarted || now - windowStarted > 15 * 60 * 1000) {
        user.failedLoginWindowStartedAt = new Date(now).toISOString();
        user.failedLoginCount = 1;
      } else {
        user.failedLoginCount += 1;
      }
      if (user.failedLoginCount >= 10) {
        user.lockedUntil = new Date(now + 15 * 60 * 1000).toISOString();
      }
    });
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
