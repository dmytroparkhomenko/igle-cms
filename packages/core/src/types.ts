import type { FieldState, SiteMetadata } from "@igle/shared";

export type RevisionSource =
  | "import"
  | "import-normalization"
  | "template"
  | "duplicate"
  | "localization"
  | "manual-field-edit"
  | "content-field-edit"
  | "visual-editor"
  | "code-editor"
  | "file-manager"
  | "page-duplicate"
  | "page-delete"
  | "page-restore"
  | "page-purge"
  | "media"
  | "ai"
  | "bulk-seo"
  | "navigation"
  | "verification"
  | "integration"
  | "custom-script"
  | "redirect"
  | "site-settings"
  | "template-variable"
  | "search-replace"
  | "restore"
  | "autosave"
  | "system";

export interface SiteRecord {
  id: string;
  slug: string;
  repoPath: string;
  metadata: SiteMetadata;
  headRevisionId?: string | undefined;
  productionRevisionId?: string | undefined;
}

export interface SiteRevisionRecord {
  id: string;
  siteId: string;
  revisionNumber: number;
  parentRevisionId?: string | undefined;
  commitSha: string;
  createdByUserId?: string | undefined;
  source: RevisionSource;
  title: string;
  description?: string | undefined;
  filesChanged: string[];
  createdAt: string;
}

export interface PageIndexRecord {
  id: string;
  siteId: string;
  filePath: string;
  route: string;
  internalName: string;
  seoTitle?: string | undefined;
  metaDescription?: string | undefined;
  h1?: string | undefined;
  canonical?: string | undefined;
  robots?: string | undefined;
  lang?: string | undefined;
  ogTitle?: string | undefined;
  ogDescription?: string | undefined;
  fieldStates: Record<string, FieldState>;
  h1Count: number;
  wordCount: number;
  imagesCount: number;
  imagesMissingAlt: number;
  inSitemap: boolean;
  fileHash: string;
  auditIssues: Array<{ code: string; severity: "error" | "warning"; message: string }>;
  lastRevisionId?: string | undefined;
  deletedAt?: string | undefined;
  trashPath?: string | undefined;
  previousInSitemap?: boolean | undefined;
}

export interface CoreState {
  sites: SiteRecord[];
  revisions: SiteRevisionRecord[];
  pages: PageIndexRecord[];
  users: UserRecord[];
  invites: InviteRecord[];
  sessions: SessionRecord[];
  drafts: DraftRecord[];
  jobs: JobRecord[];
  tasks: TaskRecord[];
  notifications: NotificationRecord[];
  deployments: DeploymentRecord[];
  servers: ServerRecord[];
  cloudflareAccounts: CloudflareAccountRecord[];
  vultrAccounts: VultrAccountRecord[];
  domains: DomainRecord[];
  /** Bridges the password step and the code step of a two-factor login — created once the password checks out, consumed (or expired) before a real session ever exists. */
  pendingTwoFactor: PendingTwoFactorRecord[];
  /** The one shared login password every registered team member's account is hashed against. */
  teamPasswordHash?: string | undefined;
  teamPasswordUpdatedAt?: string | undefined;
  /**
   * Where traffic goes, per country (2-letter ISO code, e.g. "BR", "MX") — set by an
   * administrator. Storage only for now: nothing reads or applies these to site content yet.
   */
  affiliateLinks?: Record<string, string> | undefined;
  /** ISO timestamp of the last weekly task-archive sweep (see TaskService.runWeeklyArchiveSweepIfDue) — lets the worker tell it's already run today without a second store. */
  taskArchiveSweepAt?: string | undefined;
  /** One shared bot token for task-assignment Telegram notifications — see TelegramSettingsService/TelegramNotifier. Admin-set on /integrations. */
  telegramBotToken?: string | undefined;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: "administrator" | "editor";
  passwordHash: string;
  twoFactorSecret?: string | undefined;
  twoFactorEnabled: boolean;
  /** bcrypt hashes of unused one-time backup codes — self-service recovery when the authenticator device is lost. Never store the plaintext codes; each is shown to the user exactly once, right after it's generated. */
  twoFactorBackupCodeHashes?: string[] | undefined;
  requireTwoFactor: boolean;
  lockedUntil?: string | undefined;
  failedLoginWindowStartedAt?: string | undefined;
  failedLoginCount: number;
  createdAt: string;
  /** Self-service — the user's own numeric Telegram chat ID, obtained by some external means (e.g. messaging @userinfobot) and pasted into /settings. Used to send task-assignment pings when telegramBotToken is also set. */
  telegramChatId?: string | undefined;
}

/** A registered VPS (aaPanel) a site can deploy to. `restricted` servers require an administrator actor. */
export type ServerKind = "aapanel" | "cloudpanel";

export interface ServerRecord {
  id: string;
  name: string;
  /** Which control panel (if any) manages sites on this box — determines which fields below apply and which deploy provider DeployService/DomainService reach for. */
  kind: ServerKind;
  // aaPanel: reached over its own REST API.
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  // CloudPanel: has no REST API, so it's reached over SSH running its `clpctl` CLI instead.
  sshHost?: string | undefined;
  sshPort?: number | undefined;
  sshUsername?: string | undefined;
  sshPassword?: string | undefined;
  sshPrivateKey?: string | undefined;
  restricted: boolean;
  /** The IP a domain's DNS record should point at to reach this server — auto-detected from baseUrl/sshHost when it's a plain IP, but overridable since that address isn't always the same host a domain should resolve to. */
  publicIp?: string | undefined;
  createdAt: string;
  // aaPanel only — auto-import of the panel's existing sites into Igle CMS. "pending" is set the
  // moment the server is added (or the admin re-requests it); the worker (RemoteSiteImportService)
  // picks it up in the background rather than running inline in the add-server request, since a
  // shared VPS can host dozens of sites and a full import can take well past any reasonable HTTP
  // timeout.
  autoImportStatus?: "pending" | "running" | "done" | "failed" | undefined;
  autoImportActorId?: string | undefined;
  autoImportActorEmail?: string | undefined;
  autoImportStartedAt?: string | undefined;
  autoImportFinishedAt?: string | undefined;
  /** Live progress while autoImportStatus is "running" — so the Servers page can show real movement instead of a static "Importing…" with no way to tell whether it's working or stuck. Updated at most a few times a second from the worker's onResult callback (throttled — it fires once per site, but many sites can resolve in well under a second on a fast re-check pass). */
  autoImportCurrentDomain?: string | undefined;
  autoImportSitesChecked?: number | undefined;
  autoImportSummary?:
    | {
        imported: number;
        /** Imported but came in as a locked (WordPress/MODX/other dynamic) site — a subset of `imported`, broken out so the admin can see at a glance how many need manual review. */
        locked: number;
        /** Already-tracked sites re-checked against the server's real content and newly locked as a result — see RemoteSiteImportService.reclassifyExistingSite. */
        relocked: number;
        skipped: number;
        excluded: number;
        failed: number;
        errors: Array<{ domain: string; message: string }>;
      }
    | undefined;
  /** Domains on this panel that should never be auto-imported — e.g. an unrelated app registered as a "site" in aaPanel for its own reasons, not a real Igle CMS site. */
  autoImportExcludedDomains?: string[] | undefined;
}

/** One Cloudflare account's credentials — kept separate per account (not per server) since the whole point is spreading domains across accounts that share no ownership signal. */
export interface CloudflareAccountRecord {
  id: string;
  name: string;
  apiToken: string;
  /** Needed to create a zone when the token has access to more than one account; optional since a single-account token can omit it. */
  accountId?: string | undefined;
  createdAt: string;
}

/** A registered Vultr account (Personal Access Token) — used only for read-only instance discovery, to help register a Vultr VPS as a Server without typing its IP by hand. See VultrProvider. */
export interface VultrAccountRecord {
  id: string;
  name: string;
  apiToken: string;
  createdAt: string;
}

export type DomainStatus =
  | "pending_nameservers"
  | "dns_configured"
  | "ssl_active"
  | "error";

/** A domain connected through a Cloudflare account and pointed at a server — exists independently of any site, so a domain can be provisioned before a site is ready to go on it. */
export interface DomainRecord {
  id: string;
  domain: string;
  cloudflareAccountId: string;
  serverId: string;
  zoneId?: string | undefined;
  nameservers?: string[] | undefined;
  zoneActive: boolean;
  dnsRecordId?: string | undefined;
  sslMode?: "full" | "strict" | undefined;
  status: DomainStatus;
  lastError?: string | undefined;
  siteId?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface InviteRecord {
  id: string;
  email: string;
  role: "administrator" | "editor";
  tokenHash: string;
  expiresAt: string;
  acceptedAt?: string | undefined;
}

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: string;
  revokedAt?: string | undefined;
}

/** A password check that passed but is waiting on a TOTP code — the token IS the id, so knowing it is what "possession" means here. Single-use and short-lived; never upgraded to a session directly. */
export interface PendingTwoFactorRecord {
  id: string;
  userId: string;
  expiresAt: string;
  attempts: number;
}

export interface DraftRecord {
  id: string;
  siteId: string;
  userId: string;
  filePath: string;
  baseHash: string;
  content: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  type: string;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  progress: number;
  message?: string | undefined;
  logs: string[];
  createdAt: string;
  updatedAt: string;
}

export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "open" | "in-progress" | "done" | "cancelled";

export interface TaskComment {
  id: string;
  author: string;
  /** The commenter's real account — author is a display name resolved from this at write time, so comments still read fine even if the account is later renamed or removed. */
  authorId?: string | undefined;
  body: string;
  createdAt: string;
}

export interface TaskChecklistItem {
  id: string;
  text: string;
  done: boolean;
  /** Optional — lets a specific team member own just this item, distinct from the task's own assignee. */
  assigneeId?: string | undefined;
  createdAt: string;
  completedAt?: string | undefined;
}

export interface TaskAttachment {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  /** Relative path under dataDir/task-attachments — never a full filesystem path. */
  storageKey: string;
  uploadedById?: string | undefined;
  createdAt: string;
}

export type TaskActivityAction =
  | "created"
  | "status-changed"
  | "priority-changed"
  | "reassigned"
  | "deadline-changed"
  | "checklist-item-added"
  | "checklist-item-toggled"
  | "checklist-item-removed"
  | "attachment-added"
  | "attachment-removed"
  | "archived"
  | "unarchived";

export interface TaskActivityEntry {
  id: string;
  action: TaskActivityAction;
  actorId?: string | undefined;
  /** Display-name snapshot, same rationale as TaskComment.author. */
  actorLabel: string;
  from?: string | undefined;
  to?: string | undefined;
  createdAt: string;
}

export interface TaskRecord {
  id: string;
  siteId?: string | undefined;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  deadline?: string | undefined;
  /** The team member (UserRecord.id) this task belongs to — unset means unassigned. */
  assigneeId?: string | undefined;
  /** Who created it — undefined on tasks migrated from the old `tickets` array, which never captured this. */
  creatorId?: string | undefined;
  comments: TaskComment[];
  checklist: TaskChecklistItem[];
  attachments: TaskAttachment[];
  activity: TaskActivityEntry[];
  /** Soft-archive, admin only — never hard-deleted, matching PageIndexRecord's trash/restore pattern. */
  archivedAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export type NotificationKind = "task-assigned" | "task-comment" | "task-status-changed";

export interface NotificationRecord {
  id: string;
  /** Recipient — UserRecord.id. */
  userId: string;
  kind: NotificationKind;
  taskId: string;
  /** Pre-rendered at write time, e.g. "Alice assigned you \"Fix homepage banner\"". */
  message: string;
  readAt?: string | undefined;
  createdAt: string;
}

export type DeploymentStatus = "success" | "failed" | "rolled-back";
export type DeploymentKind = "deploy" | "rollback";

export interface DeploymentRecord {
  id: string;
  siteId: string;
  revisionId: string;
  revisionNumber: number;
  kind: DeploymentKind;
  status: DeploymentStatus;
  target: "local" | "aapanel";
  releasePath?: string | undefined;
  buildIssues: Array<{ class: "error" | "warning"; code: string; message: string }>;
  error?: string | undefined;
  sslError?: string | undefined;
  createdByUserId?: string | undefined;
  createdAt: string;
}
