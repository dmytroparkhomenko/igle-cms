import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import { assertCan, IgleError, type Actor } from "@igle/shared";
import { JsonStateStore, id } from "./state-store.js";
import type { UserRecord } from "./types.js";

const TOTP_ISSUER = "Igle CMS";
const PENDING_TWO_FACTOR_TTL_MS = 5 * 60 * 1000;
const MAX_TWO_FACTOR_ATTEMPTS = 5;

/** The otpauth:// URI for a user's (pending or active) secret — what a QR code needs to encode so an authenticator app can pick it up. */
export function buildTotpOtpauthUrl(email: string, base32Secret: string): string {
  return buildTotp(email, base32Secret).toString();
}

function buildTotp(email: string, base32Secret: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: email,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30
  });
}

/** Accepts a 6-digit code with a small clock-drift window (±30s) either side — the standard tolerance authenticator apps expect a server to allow. */
function validateTotpCode(base32Secret: string, code: string): boolean {
  const trimmed = code.trim().replace(/\s+/g, "");
  if (!/^\d{6}$/.test(trimmed)) return false;
  const delta = OTPAuth.TOTP.validate({
    token: trimmed,
    secret: OTPAuth.Secret.fromBase32(base32Secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    window: 1
  });
  return delta !== null;
}

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

  /**
   * Checks email+password. If the account has 2FA enabled, this deliberately stops short of
   * creating a real session — the password alone was never meant to be enough — and instead
   * returns a short-lived pending token the caller can exchange for a session once the correct
   * code comes back through verifyTwoFactorAndCreateSession.
   */
  async createSession(
    email: string,
    password: string
  ): Promise<{ sessionId?: string; pendingTwoFactorToken?: string; requiresTwoFactor: boolean }> {
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

    user.failedLoginCount = 0;
    user.failedLoginWindowStartedAt = undefined;
    state.pendingTwoFactor = state.pendingTwoFactor.filter((item) => new Date(item.expiresAt).getTime() > Date.now());

    if (user.twoFactorEnabled && user.twoFactorSecret) {
      const token = id("2fa");
      state.pendingTwoFactor.push({
        id: token,
        userId: user.id,
        expiresAt: new Date(Date.now() + PENDING_TWO_FACTOR_TTL_MS).toISOString(),
        attempts: 0
      });
      await this.stateStore.write(state);
      return { pendingTwoFactorToken: token, requiresTwoFactor: true };
    }

    const sessionId = id("sess");
    state.sessions.push({
      id: sessionId,
      userId: user.id,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    });
    await this.stateStore.write(state);
    return { sessionId, requiresTwoFactor: false };
  }

  /** The second step of a 2FA login: exchanges a valid pending token + correct code for a real session. Wrong codes count against a per-token attempt limit rather than the account-wide login lockout, since the password already checked out. */
  async verifyTwoFactorAndCreateSession(pendingToken: string, code: string): Promise<{ sessionId: string }> {
    const state = await this.stateStore.read();
    const pending = state.pendingTwoFactor.find((item) => item.id === pendingToken);
    if (!pending || new Date(pending.expiresAt).getTime() < Date.now()) {
      state.pendingTwoFactor = state.pendingTwoFactor.filter((item) => item.id !== pendingToken);
      await this.stateStore.write(state);
      throw new IgleError("TWO_FACTOR_EXPIRED", "That sign-in attempt has expired — start over.", 401);
    }
    const user = state.users.find((item) => item.id === pending.userId);
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      state.pendingTwoFactor = state.pendingTwoFactor.filter((item) => item.id !== pendingToken);
      await this.stateStore.write(state);
      throw new IgleError("TWO_FACTOR_EXPIRED", "That sign-in attempt has expired — start over.", 401);
    }
    if (pending.attempts >= MAX_TWO_FACTOR_ATTEMPTS) {
      state.pendingTwoFactor = state.pendingTwoFactor.filter((item) => item.id !== pendingToken);
      await this.stateStore.write(state);
      throw new IgleError("TOO_MANY_ATTEMPTS", "Too many incorrect codes — start over.", 429);
    }

    if (!validateTotpCode(user.twoFactorSecret, code)) {
      pending.attempts += 1;
      await this.stateStore.write(state);
      throw new IgleError("INVALID_CODE", "That code is incorrect.", 401);
    }

    state.pendingTwoFactor = state.pendingTwoFactor.filter((item) => item.id !== pendingToken);
    const sessionId = id("sess");
    state.sessions.push({
      id: sessionId,
      userId: user.id,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    });
    await this.stateStore.write(state);
    return { sessionId };
  }

  /** Starts (or restarts) 2FA setup for the actor's own account. The secret is stored right away but 2FA doesn't actually turn on until confirmTotpEnrollment verifies a real code from it — otherwise a typo while scanning the QR code could lock the account out. */
  async beginTotpEnrollment(actor: Actor): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = new OTPAuth.Secret({ size: 20 });
    await this.stateStore.update((state) => {
      const user = state.users.find((item) => item.id === actor.id);
      if (!user) throw new IgleError("USER_NOT_FOUND", "User does not exist.", 404);
      user.twoFactorSecret = secret.base32;
      user.twoFactorEnabled = false;
    });
    return { secret: secret.base32, otpauthUrl: buildTotp(actor.email, secret.base32).toString() };
  }

  /** Confirms setup with a real code from the authenticator app — this is the moment 2FA actually turns on. */
  async confirmTotpEnrollment(actor: Actor, code: string): Promise<void> {
    const state = await this.stateStore.read();
    const user = state.users.find((item) => item.id === actor.id);
    if (!user) throw new IgleError("USER_NOT_FOUND", "User does not exist.", 404);
    if (!user.twoFactorSecret) throw new IgleError("TWO_FACTOR_NOT_STARTED", "Start two-factor setup first.", 400);
    if (!validateTotpCode(user.twoFactorSecret, code)) throw new IgleError("INVALID_CODE", "That code is incorrect.", 401);
    await this.stateStore.update((current) => {
      const record = current.users.find((item) => item.id === actor.id);
      if (record) record.twoFactorEnabled = true;
    });
  }

  /** Turns 2FA off for the actor's own account. Requires a currently-valid code (not just an active session) so a momentarily-unlocked device can't silently strip the protection back off. */
  async disableTotp(actor: Actor, code: string): Promise<void> {
    const state = await this.stateStore.read();
    const user = state.users.find((item) => item.id === actor.id);
    if (!user) throw new IgleError("USER_NOT_FOUND", "User does not exist.", 404);
    if (!user.twoFactorEnabled || !user.twoFactorSecret) return;
    if (!validateTotpCode(user.twoFactorSecret, code)) throw new IgleError("INVALID_CODE", "That code is incorrect.", 401);
    await this.stateStore.update((current) => {
      const record = current.users.find((item) => item.id === actor.id);
      if (record) {
        record.twoFactorEnabled = false;
        record.twoFactorSecret = undefined;
      }
    });
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
