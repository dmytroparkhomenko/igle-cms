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
  tickets: TicketRecord[];
  deployments: DeploymentRecord[];
  servers: ServerRecord[];
  cloudflareAccounts: CloudflareAccountRecord[];
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
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: "administrator" | "editor";
  passwordHash: string;
  /** Deploying/moving a site onto a server flagged `restricted` requires this — off by default for everyone but the bootstrap admin. */
  canDeployRestricted: boolean;
  twoFactorSecret?: string | undefined;
  twoFactorEnabled: boolean;
  requireTwoFactor: boolean;
  lockedUntil?: string | undefined;
  failedLoginWindowStartedAt?: string | undefined;
  failedLoginCount: number;
  createdAt: string;
}

/** A registered VPS (aaPanel) a site can deploy to. `restricted` servers require canDeployRestricted on the actor. */
export interface ServerRecord {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  restricted: boolean;
  /** The IP a domain's DNS record should point at to reach this server — auto-detected from baseUrl when it's a plain IP, but overridable since baseUrl is the aaPanel *panel* address and isn't always the same host. */
  publicIp?: string | undefined;
  createdAt: string;
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

export type TicketSpecialistType = "developer" | "designer" | "seo" | "copywriter";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketStatus = "open" | "in-progress" | "done" | "cancelled";

export interface TicketComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface TicketRecord {
  id: string;
  siteId?: string | undefined;
  title: string;
  description: string;
  specialistType: TicketSpecialistType;
  priority: TicketPriority;
  status: TicketStatus;
  deadline?: string | undefined;
  comments: TicketComment[];
  createdAt: string;
  updatedAt: string;
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
