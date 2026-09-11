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
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: "administrator" | "editor";
  passwordHash: string;
  twoFactorSecret?: string | undefined;
  twoFactorEnabled: boolean;
  requireTwoFactor: boolean;
  lockedUntil?: string | undefined;
  failedLoginWindowStartedAt?: string | undefined;
  failedLoginCount: number;
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
