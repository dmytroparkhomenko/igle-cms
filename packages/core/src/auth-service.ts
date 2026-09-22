import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import { assertCan, IgleError, taskCategories, type Actor, type TaskCategory } from "@igle/shared";
import { JsonStateStore, id } from "./state-store.js";
import type { UserRecord } from "./types.js";

const TOTP_ISSUER = "Igle CMS";
const PENDING_TWO_FACTOR_TTL_MS = 5 * 60 * 1000;
const SETUP_TWO_FACTOR_TTL_MS = 15 * 60 * 1000;
const MAX_TWO_FACTOR_ATTEMPTS = 5;
const BACKUP_CODE_COUNT = 8;

/** Ten hex characters, formatted like "A1B2C-D3E4F" — enough entropy for a one-time local recovery code, no ambiguous characters (pure hex) to transcribe from a saved list. */
function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

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
  /** Descriptive task-assignment tags — not a permission. */
  tags: TaskCategory[];
  twoFactorEnabled: boolean;
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

  /** Every team member's id/name/email/tags, no admin gate — for pickers like a task's assignee, where any signed-in member needs to see who's on the team, not just administrators. */
  async listSelectable(_actor: Actor): Promise<Array<{ id: string; name: string; email: string; tags: TaskCategory[] }>> {
    const state = await this.stateStore.read();
    return state.users
      .map((user) => ({ id: user.id, name: user.name, email: user.email, tags: user.tags }))
      .sort((a, b) => a.email.localeCompare(b.email));
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
        tags: user.tags,
        twoFactorEnabled: user.twoFactorEnabled,
        createdAt: user.createdAt,
        lockedUntil: user.lockedUntil
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  /** Admin-only. Descriptive task-assignment tags for this member — not a permission grant, just what shows up first in a task's assignee picker. */
  async setUserTags(userId: string, tags: TaskCategory[], actor: Actor): Promise<void> {
    assertCan(actor, "users.manage");
    const uniqueValidTags = [...new Set(tags)].filter((tag) => (taskCategories as readonly string[]).includes(tag));
    await this.stateStore.update((state) => {
      const user = state.users.find((item) => item.id === userId);
      if (!user) throw new IgleError("USER_NOT_FOUND", "Member was not found.", 404);
      user.tags = uniqueValidTags;
    });
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

  async removeTeamMember(userId: string, actor: Actor): Promise<void> {
    assertCan(actor, "users.manage");
    if (userId === actor.id) throw new IgleError("CANNOT_REMOVE_SELF", "You can't remove your own account.", 400);
    await this.stateStore.update((state) => {
      state.users = state.users.filter((user) => user.id !== userId);
      state.sessions = state.sessions.filter((session) => session.userId !== userId);
      for (const task of state.tasks) {
        if (task.assigneeId === userId) task.assigneeId = undefined;
        for (const item of task.checklist) {
          if (item.assigneeId === userId) item.assigneeId = undefined;
        }
      }
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
    return { id: user.id, email: user.email, role: user.role };
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
   * Checks email+password — always the SAME shared password, per account, no individual resets.
   * Two-factor is mandatory for every account, so this never creates a session directly: it
   * always returns a short-lived pending token instead. If the account has never completed 2FA
   * setup yet, a secret is generated right here (reusing one already in progress rather than
   * replacing it, so the QR code doesn't change between attempts) — the caller shows either "enter
   * your code" or "scan this QR code" based on setupRequired, but either way the code is checked
   * by the same verifyTwoFactorAndCreateSession.
   */
  async createSession(
    email: string,
    password: string
  ): Promise<{ pendingTwoFactorToken: string; setupRequired: boolean }> {
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

    const setupRequired = !user.twoFactorEnabled;
    if (!user.twoFactorSecret) {
      user.twoFactorSecret = new OTPAuth.Secret({ size: 20 }).base32;
    }

    const token = id("2fa");
    state.pendingTwoFactor.push({
      id: token,
      userId: user.id,
      expiresAt: new Date(Date.now() + (setupRequired ? SETUP_TWO_FACTOR_TTL_MS : PENDING_TWO_FACTOR_TTL_MS)).toISOString(),
      attempts: 0
    });
    await this.stateStore.write(state);
    return { pendingTwoFactorToken: token, setupRequired };
  }

  /** Read-only lookup for the login-verify/setup page: which account a pending token belongs to, and whether it still needs the QR-code setup step or just a code from an already-configured app. Safe to call with no Actor — the pending token itself is what proves the password already checked out. */
  async getPendingTwoFactorContext(pendingToken: string): Promise<{ email: string; setupRequired: boolean; otpauthUrl?: string } | undefined> {
    const state = await this.stateStore.read();
    const pending = state.pendingTwoFactor.find((item) => item.id === pendingToken);
    if (!pending || new Date(pending.expiresAt).getTime() < Date.now()) return undefined;
    const user = state.users.find((item) => item.id === pending.userId);
    if (!user || !user.twoFactorSecret) return undefined;
    const setupRequired = !user.twoFactorEnabled;
    return {
      email: user.email,
      setupRequired,
      ...(setupRequired ? { otpauthUrl: buildTotp(user.email, user.twoFactorSecret).toString() } : {})
    };
  }

  /**
   * Exchanges a valid pending token + correct code for a real session — the one path that covers
   * both "enter your existing code" and "confirm the code from the QR code you just scanned"
   * (first-time setup), since the check is identical either way: if the account hadn't completed
   * setup yet, this is also the moment it does. Wrong codes count against a per-token attempt
   * limit rather than the account-wide login lockout, since the password already checked out.
   */
  async verifyTwoFactorAndCreateSession(pendingToken: string, code: string): Promise<{ sessionId: string; backupCodes?: string[] }> {
    const state = await this.stateStore.read();
    const pending = state.pendingTwoFactor.find((item) => item.id === pendingToken);
    if (!pending || new Date(pending.expiresAt).getTime() < Date.now()) {
      state.pendingTwoFactor = state.pendingTwoFactor.filter((item) => item.id !== pendingToken);
      await this.stateStore.write(state);
      throw new IgleError("TWO_FACTOR_EXPIRED", "That sign-in attempt has expired — start over.", 401);
    }
    const user = state.users.find((item) => item.id === pending.userId);
    if (!user || !user.twoFactorSecret) {
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

    // Generating backup codes the moment 2FA first turns on (not before, and not on every
    // ordinary login) ties them to this secret's "epoch" — a fresh set every time setup happens,
    // including a redo after adminResetTwoFactor or a lost-device recovery, so old codes tied to
    // a secret that's no longer in use can never be replayed.
    const wasSetupRequired = !user.twoFactorEnabled;
    let backupCodes: string[] | undefined;
    if (wasSetupRequired) {
      backupCodes = generateBackupCodes();
      user.twoFactorBackupCodeHashes = await Promise.all(backupCodes.map((backupCode) => bcrypt.hash(backupCode, 10)));
    }

    user.twoFactorEnabled = true;
    state.pendingTwoFactor = state.pendingTwoFactor.filter((item) => item.id !== pendingToken);
    const sessionId = id("sess");
    state.sessions.push({
      id: sessionId,
      userId: user.id,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
    });
    await this.stateStore.write(state);
    return { sessionId, ...(backupCodes ? { backupCodes } : {}) };
  }

  /**
   * Self-service recovery for a lost/wiped authenticator device — no admin needed. Each backup
   * code works once; a correct one immediately retires the old secret and remaining codes and
   * routes this SAME pending sign-in straight back into fresh setup (a new QR code), the same
   * "next login walks you through setup again" outcome adminResetTwoFactor produces, just
   * triggered by the account holder instead of another administrator.
   */
  async verifyBackupCodeAndRestartSetup(pendingToken: string, code: string): Promise<void> {
    const state = await this.stateStore.read();
    const pending = state.pendingTwoFactor.find((item) => item.id === pendingToken);
    if (!pending || new Date(pending.expiresAt).getTime() < Date.now()) {
      state.pendingTwoFactor = state.pendingTwoFactor.filter((item) => item.id !== pendingToken);
      await this.stateStore.write(state);
      throw new IgleError("TWO_FACTOR_EXPIRED", "That sign-in attempt has expired — start over.", 401);
    }
    const user = state.users.find((item) => item.id === pending.userId);
    if (!user) {
      state.pendingTwoFactor = state.pendingTwoFactor.filter((item) => item.id !== pendingToken);
      await this.stateStore.write(state);
      throw new IgleError("TWO_FACTOR_EXPIRED", "That sign-in attempt has expired — start over.", 401);
    }
    if (pending.attempts >= MAX_TWO_FACTOR_ATTEMPTS) {
      state.pendingTwoFactor = state.pendingTwoFactor.filter((item) => item.id !== pendingToken);
      await this.stateStore.write(state);
      throw new IgleError("TOO_MANY_ATTEMPTS", "Too many incorrect codes — start over.", 429);
    }

    const hashes = user.twoFactorBackupCodeHashes ?? [];
    const normalized = normalizeBackupCode(code);
    let matchedIndex = -1;
    for (let i = 0; i < hashes.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(normalized, hashes[i]!)) {
        matchedIndex = i;
        break;
      }
    }
    if (matchedIndex === -1) {
      pending.attempts += 1;
      await this.stateStore.write(state);
      throw new IgleError("INVALID_CODE", "That backup code is incorrect or has already been used.", 401);
    }

    user.twoFactorSecret = new OTPAuth.Secret({ size: 20 }).base32;
    user.twoFactorEnabled = false;
    user.twoFactorBackupCodeHashes = hashes.filter((_, index) => index !== matchedIndex);
    pending.attempts = 0;
    pending.expiresAt = new Date(Date.now() + SETUP_TWO_FACTOR_TTL_MS).toISOString();
    await this.stateStore.write(state);
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
  async confirmTotpEnrollment(actor: Actor, code: string): Promise<{ backupCodes?: string[] }> {
    const state = await this.stateStore.read();
    const user = state.users.find((item) => item.id === actor.id);
    if (!user) throw new IgleError("USER_NOT_FOUND", "User does not exist.", 404);
    if (!user.twoFactorSecret) throw new IgleError("TWO_FACTOR_NOT_STARTED", "Start two-factor setup first.", 400);
    if (!validateTotpCode(user.twoFactorSecret, code)) throw new IgleError("INVALID_CODE", "That code is incorrect.", 401);

    const wasSetupRequired = !user.twoFactorEnabled;
    const backupCodes = wasSetupRequired ? generateBackupCodes() : undefined;
    const backupCodeHashes = backupCodes ? await Promise.all(backupCodes.map((backupCode) => bcrypt.hash(backupCode, 10))) : undefined;

    await this.stateStore.update((current) => {
      const record = current.users.find((item) => item.id === actor.id);
      if (record) {
        record.twoFactorEnabled = true;
        if (backupCodeHashes) record.twoFactorBackupCodeHashes = backupCodeHashes;
      }
    });
    return { ...(backupCodes ? { backupCodes } : {}) };
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
        record.twoFactorBackupCodeHashes = undefined;
      }
    });
  }

  /** Self-service: replaces the actor's own backup codes with a fresh set (e.g. after using some, or losing the saved list) — requires a currently-valid code for the same reason disableTotp does. */
  async regenerateBackupCodes(actor: Actor, code: string): Promise<{ codes: string[] }> {
    const state = await this.stateStore.read();
    const user = state.users.find((item) => item.id === actor.id);
    if (!user) throw new IgleError("USER_NOT_FOUND", "User does not exist.", 404);
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new IgleError("TWO_FACTOR_NOT_ENABLED", "Turn on two-factor authentication first.", 400);
    }
    if (!validateTotpCode(user.twoFactorSecret, code)) throw new IgleError("INVALID_CODE", "That code is incorrect.", 401);

    const codes = generateBackupCodes();
    const hashes = await Promise.all(codes.map((backupCode) => bcrypt.hash(backupCode, 10)));
    await this.stateStore.update((current) => {
      const record = current.users.find((item) => item.id === actor.id);
      if (record) record.twoFactorBackupCodeHashes = hashes;
    });
    return { codes };
  }

  /**
   * Admin-only recovery path: clears another user's 2FA secret outright, no code required —
   * for when someone lost the device their authenticator app was on (disableTotp can't help
   * there, since it requires a currently-valid code from that same lost device). Their next
   * login is routed back through mandatory setup, same as a brand-new account.
   */
  async adminResetTwoFactor(userId: string, actor: Actor): Promise<void> {
    assertCan(actor, "users.manage");
    await this.stateStore.update((state) => {
      const user = state.users.find((item) => item.id === userId);
      if (!user) throw new IgleError("USER_NOT_FOUND", "User does not exist.", 404);
      user.twoFactorEnabled = false;
      user.twoFactorSecret = undefined;
      user.twoFactorBackupCodeHashes = undefined;
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
      tags: [],
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
