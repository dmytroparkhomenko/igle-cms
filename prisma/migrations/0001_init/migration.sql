-- Initial Igle CMS schema. Prisma owns the detailed generated migration in production;
-- this SQL is intentionally explicit for review and Docker bootstrap.
CREATE TYPE "UserRole" AS ENUM ('administrator', 'editor');
CREATE TYPE "SiteStatus" AS ENUM ('draft', 'published', 'archived');
CREATE TYPE "SourceType" AS ENUM ('import', 'template', 'duplicate', 'blank');
CREATE TYPE "FieldState" AS ENUM ('inherited', 'explicit', 'manual_source', 'absent', 'ambiguous');

CREATE TABLE "User" (
  "id" text PRIMARY KEY,
  "email" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "role" "UserRole" NOT NULL,
  "passwordHash" text NOT NULL,
  "twoFactorSecret" text,
  "twoFactorEnabled" boolean NOT NULL DEFAULT false,
  "requireTwoFactor" boolean NOT NULL DEFAULT false,
  "lockedUntil" timestamptz,
  "failedLoginWindowStartedAt" timestamptz,
  "failedLoginCount" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Site" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "domain" text,
  "alternateDomains" jsonb NOT NULL DEFAULT '[]',
  "brandName" text,
  "country" text,
  "region" text,
  "city" text,
  "language" text NOT NULL,
  "locale" text NOT NULL,
  "urlStyle" text NOT NULL,
  "wwwMode" text NOT NULL,
  "https" boolean NOT NULL DEFAULT true,
  "status" "SiteStatus" NOT NULL DEFAULT 'draft',
  "sourceType" "SourceType" NOT NULL,
  "templateKey" text,
  "templateVersion" text,
  "duplicatedFromSiteId" text,
  "duplicatedFromRevisionId" text,
  "headRevisionId" text,
  "productionRevisionId" text,
  "deploymentTargetId" text,
  "tags" jsonb NOT NULL DEFAULT '[]',
  "aiContext" jsonb,
  "affiliateOffers" jsonb,
  "seoLimits" jsonb NOT NULL,
  "repoPath" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "lastDeployedAt" timestamptz
);

CREATE TABLE "Session" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "expiresAt" timestamptz NOT NULL,
  "revokedAt" timestamptz
);

CREATE TABLE "SiteAccess" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "siteId" text NOT NULL REFERENCES "Site"("id") ON DELETE CASCADE,
  "canEditCode" boolean NOT NULL DEFAULT false,
  "canDeploy" boolean NOT NULL DEFAULT false,
  UNIQUE ("userId", "siteId")
);

CREATE TABLE "Page" (
  "id" text PRIMARY KEY,
  "siteId" text NOT NULL REFERENCES "Site"("id") ON DELETE CASCADE,
  "filePath" text NOT NULL,
  "route" text NOT NULL,
  "internalName" text NOT NULL,
  "pageType" text,
  "primaryKeyword" text,
  "seoTitle" text,
  "metaDescription" text,
  "h1" text,
  "canonical" text,
  "robots" text,
  "lang" text,
  "ogTitle" text,
  "ogDescription" text,
  "ogImage" text,
  "twitter" jsonb,
  "hreflang" jsonb,
  "schemaBlocks" jsonb,
  "fieldStates" jsonb NOT NULL,
  "h1Count" integer NOT NULL DEFAULT 0,
  "wordCount" integer NOT NULL DEFAULT 0,
  "imagesCount" integer NOT NULL DEFAULT 0,
  "imagesMissingAlt" integer NOT NULL DEFAULT 0,
  "internalLinksIn" integer NOT NULL DEFAULT 0,
  "internalLinksOut" integer NOT NULL DEFAULT 0,
  "inSitemap" boolean NOT NULL DEFAULT true,
  "fileHash" text NOT NULL,
  "auditIssues" jsonb NOT NULL DEFAULT '[]',
  "lastRevisionId" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("siteId", "filePath")
);

CREATE TABLE "SiteRevision" (
  "id" text PRIMARY KEY,
  "siteId" text NOT NULL REFERENCES "Site"("id") ON DELETE CASCADE,
  "revisionNumber" integer NOT NULL,
  "parentRevisionId" text,
  "commitSha" text NOT NULL,
  "createdByUserId" text REFERENCES "User"("id"),
  "source" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "filesChanged" jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("siteId", "revisionNumber"),
  UNIQUE ("siteId", "commitSha")
);

CREATE TABLE "Draft" (
  "id" text PRIMARY KEY,
  "siteId" text NOT NULL REFERENCES "Site"("id") ON DELETE CASCADE,
  "userId" text NOT NULL,
  "filePath" text NOT NULL,
  "baseHash" text NOT NULL,
  "content" text NOT NULL,
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("siteId", "userId", "filePath")
);

CREATE TABLE "Template" ("id" text PRIMARY KEY, "key" text NOT NULL UNIQUE, "name" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "TemplateVersion" ("id" text PRIMARY KEY, "templateId" text NOT NULL REFERENCES "Template"("id") ON DELETE CASCADE, "version" text NOT NULL, "path" text NOT NULL, "manifest" jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE ("templateId", "version"));
CREATE TABLE "MediaAsset" ("id" text PRIMARY KEY, "siteId" text NOT NULL REFERENCES "Site"("id") ON DELETE CASCADE, "path" text NOT NULL, "mimeType" text NOT NULL, "byteSize" integer NOT NULL, "hash" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "AssetUsage" ("id" text PRIMARY KEY, "assetId" text NOT NULL REFERENCES "MediaAsset"("id") ON DELETE CASCADE, "pageId" text, "filePath" text NOT NULL);
CREATE TABLE "Server" ("id" text PRIMARY KEY, "name" text NOT NULL, "host" text NOT NULL, "port" integer NOT NULL DEFAULT 22, "username" text NOT NULL, "privateKeyEncrypted" text NOT NULL, "passphraseEncrypted" text, "publicKey" text NOT NULL, "hostKeyFingerprint" text, "webRootBase" text NOT NULL, "nginxIncludeDir" text NOT NULL, "useSudo" boolean NOT NULL DEFAULT false, "webServer" text NOT NULL DEFAULT 'nginx', "lastCheck" jsonb);
CREATE TABLE "DeploymentTarget" ("id" text PRIMARY KEY, "siteId" text NOT NULL REFERENCES "Site"("id") ON DELETE CASCADE, "serverId" text NOT NULL REFERENCES "Server"("id"), "name" text NOT NULL, "isDefault" boolean NOT NULL DEFAULT false, "remoteDirectory" text NOT NULL, "sslEnabled" boolean NOT NULL DEFAULT true, "sslExpiresAt" timestamptz, "keepReleases" integer NOT NULL DEFAULT 10, "healthCheckPath" text NOT NULL DEFAULT '/', "healthCheckStatus" text, "autoRollback" boolean NOT NULL DEFAULT true, "provisionedAt" timestamptz, "nginxConfigHash" text);
CREATE TABLE "Build" ("id" text PRIMARY KEY, "siteId" text NOT NULL, "revisionId" text NOT NULL, "path" text NOT NULL, "status" text NOT NULL, "log" jsonb NOT NULL DEFAULT '[]', "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "Deployment" ("id" text PRIMARY KEY, "siteId" text NOT NULL, "targetId" text NOT NULL REFERENCES "DeploymentTarget"("id"), "revisionId" text NOT NULL, "status" text NOT NULL, "releasePath" text, "createdAt" timestamptz NOT NULL DEFAULT now(), "completedAt" timestamptz);
CREATE TABLE "DeploymentLog" ("id" text PRIMARY KEY, "deploymentId" text NOT NULL REFERENCES "Deployment"("id") ON DELETE CASCADE, "level" text NOT NULL, "message" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "SiteVerification" ("id" text PRIMARY KEY, "siteId" text NOT NULL, "provider" text NOT NULL, "filePath" text, "metaName" text, "contentHash" text NOT NULL, "status" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "SiteIntegration" ("id" text PRIMARY KEY, "siteId" text NOT NULL, "provider" text NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "encryptedConfiguration" text, "status" text NOT NULL, "draftRevisionId" text, "productionRevisionId" text, "lastVerifiedAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "IntegrationOperation" ("id" text PRIMARY KEY, "siteIntegrationId" text NOT NULL REFERENCES "SiteIntegration"("id") ON DELETE CASCADE, "operation" text NOT NULL, "revisionId" text, "status" text NOT NULL, "log" jsonb NOT NULL DEFAULT '[]', "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "CustomScript" ("id" text PRIMARY KEY, "siteId" text NOT NULL, "name" text NOT NULL, "placement" text NOT NULL, "environment" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "Redirect" ("id" text PRIMARY KEY, "siteId" text NOT NULL, "from" text NOT NULL, "to" text NOT NULL, "status" integer NOT NULL DEFAULT 301);
CREATE TABLE "AIProviderConfiguration" ("id" text PRIMARY KEY, "name" text NOT NULL, "provider" text NOT NULL, "baseUrl" text, "apiKeyEncrypted" text NOT NULL, "enabled" boolean NOT NULL DEFAULT true);
CREATE TABLE "AITaskConfig" ("id" text PRIMARY KEY, "task" text NOT NULL UNIQUE, "model" text NOT NULL, "providerId" text NOT NULL, "budgetCapPercent" integer NOT NULL DEFAULT 100, "enabled" boolean NOT NULL DEFAULT true);
CREATE TABLE "PromptTemplate" ("id" text PRIMARY KEY, "task" text NOT NULL, "name" text NOT NULL);
CREATE TABLE "PromptVersion" ("id" text PRIMARY KEY, "promptTemplateId" text NOT NULL REFERENCES "PromptTemplate"("id") ON DELETE CASCADE, "version" integer NOT NULL, "content" text NOT NULL, "schema" jsonb, "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "AIGeneration" ("id" text PRIMARY KEY, "siteId" text NOT NULL, "pageId" text, "task" text NOT NULL, "tokens" integer NOT NULL, "cost" numeric NOT NULL, "latencyMs" integer NOT NULL, "status" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "AISuggestion" ("id" text PRIMARY KEY, "siteId" text NOT NULL, "pageId" text, "jobId" text, "task" text NOT NULL, "field" text NOT NULL, "currentValue" text, "proposedValue" text NOT NULL, "validationNotes" text, "status" text NOT NULL, "decidedByUserId" text, "decidedAt" timestamptz);
CREATE TABLE "Generation" ("id" text PRIMARY KEY, "siteId" text, "status" text NOT NULL, "state" jsonb NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "Import" ("id" text PRIMARY KEY, "siteId" text, "status" text NOT NULL, "report" jsonb, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "Job" ("id" text PRIMARY KEY, "type" text NOT NULL, "status" text NOT NULL, "progress" integer NOT NULL DEFAULT 0, "message" text, "logs" jsonb NOT NULL DEFAULT '[]', "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "Notification" ("id" text PRIMARY KEY, "userId" text, "type" text NOT NULL, "title" text NOT NULL, "body" text NOT NULL, "readAt" timestamptz, "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "AuditLog" ("id" text PRIMARY KEY, "actorId" text, "action" text NOT NULL, "targetType" text NOT NULL, "targetId" text, "details" jsonb NOT NULL DEFAULT '{}', "createdAt" timestamptz NOT NULL DEFAULT now());
CREATE TABLE "Setting" ("key" text PRIMARY KEY, "value" jsonb NOT NULL, "updatedAt" timestamptz NOT NULL DEFAULT now());
