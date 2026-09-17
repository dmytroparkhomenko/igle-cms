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
  /** The one shared login password every registered team member's account is hashed against. */
  teamPasswordHash?: string | undefined;
  teamPasswordUpdatedAt?: string | undefined;
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
  createdAt: string;
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
