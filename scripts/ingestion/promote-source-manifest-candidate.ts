import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  isCatalogReconciliationComplete,
  loadSourceManifestFiles,
  sourceManifestV2Schema,
  validateSourceManifests,
  type SourceManifestV2,
} from "../source-manifest-registry";
import {
  verifySourceManifestCohortArtifact,
  type SourceManifestCohortArtifactManifest,
} from "./build-source-manifest-cohort";

const candidatePathSchema = z
  .string()
  .regex(/^manifests\/\d{3}-[a-z0-9-]+\.v2\.candidate\.json$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
function isRealUtcCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const checkedAtSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(isRealUtcCalendarDate, {
    message: "reviewedAt must be a real ISO calendar date",
  });

export const sourceManifestPromotionReviewSchema = z
  .object({
    format: z.literal("studyinchina.source-manifest-v2-promotion-review"),
    formatVersion: z.literal(1),
    decision: z.literal("approve_complete_manifest"),
    reviewedAt: checkedAtSchema,
    reviewer: z.string().trim().min(3).max(200),
    rationale: z.string().trim().min(20).max(4_000),
    artifact: z
      .object({
        cohortId: z.string().min(1),
        candidatePath: candidatePathSchema,
        candidateSha256: sha256Schema,
      })
      .strict(),
    manifest: sourceManifestV2Schema,
  })
  .strict();

export type SourceManifestPromotionReview = z.infer<
  typeof sourceManifestPromotionReviewSchema
>;

export type PromoteSourceManifestCandidateOptions = {
  artifactDirectory: string;
  reviewDecisionPath: string;
  repositoryRoot?: string;
  write?: boolean;
};

export type SourceManifestPromotionResult = {
  mode: "dry-run" | "write";
  cohortId: string;
  candidatePath: string;
  candidateSha256: string;
  reviewDecisionSha256: string;
  institutionId: string;
  destinationPath: string;
  manifestSha256: string;
  sources: number;
  reconciliationEntries: number;
  qualityGate: {
    catalogReconciliationComplete: true;
    pendingEntries: 0;
    discoveryPendingCoverage: 0;
    auditOnlyMarkers: 0;
  };
};

type PromotionCli = {
  artifactDirectory: string;
  reviewDecisionPath: string;
  write: boolean;
};

const CLI_USAGE = [
  "Usage:",
  "  --artifact <verified-candidate-bundle> --review-decision <review.json> [--write]",
  "",
  "Without --write the command performs a dry-run and does not create a formal manifest.",
].join("\n");

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path))
  );
}

function resolveThroughExistingAncestor(path: string): string {
  let ancestor = resolve(path);
  const suffix: string[] = [];
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      throw new Error("Unable to resolve destination ancestor for " + path);
    }
    suffix.unshift(relative(parent, ancestor));
    ancestor = parent;
  }
  return resolve(realpathSync(ancestor), ...suffix);
}

function readRegularFile(path: string, label: string): Buffer {
  if (!existsSync(path)) throw new Error(label + " does not exist");
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(label + " must be a regular, non-symbolic-link file");
  }
  return readFileSync(path);
}

function readArtifactManifest(
  artifactDirectory: string,
): SourceManifestCohortArtifactManifest {
  return JSON.parse(
    readFileSync(join(artifactDirectory, "artifact-manifest.v1.json"), "utf8"),
  ) as SourceManifestCohortArtifactManifest;
}

function containsAuditOnlyMarker(value: unknown): boolean {
  if (typeof value === "string") return /audit[\s_-]*only/iu.test(value);
  if (Array.isArray(value)) return value.some(containsAuditOnlyMarker);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(containsAuditOnlyMarker);
  }
  return false;
}

function assertNoExistingInstitution(
  manifestDirectory: string,
  institutionId: string,
): void {
  for (const existing of loadSourceManifestFiles(manifestDirectory)) {
    if (
      typeof existing.value === "object" &&
      existing.value !== null &&
      "institutionId" in existing.value &&
      existing.value.institutionId === institutionId
    ) {
      throw new Error(
        `Formal manifest already exists for institutionId ${institutionId}: ${existing.filePath}`,
      );
    }
  }
}

function formalDestination(
  repositoryRoot: string,
  candidatePath: string,
): { directory: string; path: string } {
  if (!candidatePathSchema.safeParse(candidatePath).success) {
    throw new Error("Unsafe candidate path: " + candidatePath);
  }
  const formalRoot = resolve(repositoryRoot, "content/source-manifests");
  if (!existsSync(formalRoot) || lstatSync(formalRoot).isSymbolicLink()) {
    throw new Error("Formal manifest root must be a real directory");
  }
  const candidateName = posix.basename(candidatePath);
  const formalName = candidateName.replace(".v2.candidate.json", ".v2.json");
  const directory = resolve(formalRoot, "double-first-class/institutions");
  const path = resolve(directory, formalName);
  const effectiveRoot = realpathSync(formalRoot);
  const effectiveDestination = resolveThroughExistingAncestor(path);
  if (
    !isInside(formalRoot, path) ||
    !isInside(effectiveRoot, effectiveDestination)
  ) {
    throw new Error(
      "Formal manifest destination escapes content/source-manifests",
    );
  }
  if (existsSync(path)) {
    throw new Error("Refusing to overwrite existing formal manifest: " + path);
  }
  return { directory, path };
}

function assertReviewLineage(
  review: SourceManifestPromotionReview,
  candidate: SourceManifestV2,
): void {
  if (review.manifest.institutionId !== candidate.institutionId) {
    throw new Error(
      "Reviewed manifest institutionId does not match the candidate",
    );
  }
  if (review.manifest.catalogStatus !== candidate.catalogStatus) {
    throw new Error(
      "Reviewed manifest catalogStatus does not match the candidate",
    );
  }
  if (review.manifest.checkedAt < candidate.checkedAt) {
    throw new Error("Reviewed manifest checkedAt predates the candidate");
  }
  if (review.reviewedAt < review.manifest.checkedAt) {
    throw new Error("Review decision predates the reviewed manifest");
  }
}

function assertCompleteReviewedManifest(manifest: SourceManifestV2): void {
  if (!isCatalogReconciliationComplete(manifest)) {
    throw new Error(
      "Promotion requires a complete manifest and complete catalog reconciliation",
    );
  }
  if (
    manifest.catalogReconciliation.entries.some(
      (entry) => entry.status === "pending",
    )
  ) {
    throw new Error("Promotion refuses pending catalog reconciliation entries");
  }
  if (
    manifest.coverage.some(
      (coverage) => coverage.status === "discovery_pending",
    )
  ) {
    throw new Error("Promotion refuses discovery_pending coverage");
  }
}

export function promoteSourceManifestCandidate(
  options: PromoteSourceManifestCandidateOptions,
): SourceManifestPromotionResult {
  const repositoryRoot = resolve(options.repositoryRoot ?? ".");
  const artifactDirectory = resolve(options.artifactDirectory);
  const reviewDecisionPath = resolve(options.reviewDecisionPath);

  // This verifies the artifact manifest, SHA256SUMS, every described file,
  // candidate schema, disabled source state, and exact file inventory first.
  const artifactVerification =
    verifySourceManifestCohortArtifact(artifactDirectory);
  const artifactManifest = readArtifactManifest(artifactDirectory);
  const reviewBytes = readRegularFile(reviewDecisionPath, "Review decision");
  const review = sourceManifestPromotionReviewSchema.parse(
    JSON.parse(reviewBytes.toString("utf8")),
  );

  if (review.artifact.cohortId !== artifactVerification.cohortId) {
    throw new Error(
      "Review decision cohortId does not match the verified artifact",
    );
  }
  const describedCandidate = artifactManifest.files.find(
    (file) => file.path === review.artifact.candidatePath,
  );
  if (!describedCandidate) {
    throw new Error(
      "Review decision candidatePath is absent from the verified artifact",
    );
  }
  const candidateBytes = readRegularFile(
    join(artifactDirectory, ...review.artifact.candidatePath.split("/")),
    "Candidate manifest",
  );
  const candidateSha256 = sha256(candidateBytes);
  if (
    review.artifact.candidateSha256 !== candidateSha256 ||
    describedCandidate.sha256 !== candidateSha256
  ) {
    throw new Error(
      "Review decision candidateSha256 does not exactly match the artifact",
    );
  }
  const candidate = sourceManifestV2Schema.parse(
    JSON.parse(candidateBytes.toString("utf8")),
  );
  if (containsAuditOnlyMarker(candidate)) {
    throw new Error(
      "AUDIT ONLY and audit-only synthetic candidates cannot be promoted",
    );
  }
  if (containsAuditOnlyMarker(review.manifest)) {
    throw new Error(
      "AUDIT ONLY and audit-only markers are forbidden in formal manifests",
    );
  }

  assertReviewLineage(review, candidate);
  assertCompleteReviewedManifest(review.manifest);

  const destination = formalDestination(
    repositoryRoot,
    review.artifact.candidatePath,
  );
  const formalRoot = resolve(repositoryRoot, "content/source-manifests");
  assertNoExistingInstitution(formalRoot, review.manifest.institutionId);
  validateSourceManifests(
    [
      ...loadSourceManifestFiles(formalRoot),
      { filePath: destination.path, value: review.manifest },
    ],
    resolve(repositoryRoot, "content/data/universities.json"),
  );

  const manifestBody = serializeJson(review.manifest);
  if (options.write === true) {
    mkdirSync(destination.directory, { recursive: true });
    writeFileSync(destination.path, manifestBody, {
      encoding: "utf8",
      flag: "wx",
    });
  }

  return {
    mode: options.write === true ? "write" : "dry-run",
    cohortId: artifactVerification.cohortId,
    candidatePath: review.artifact.candidatePath,
    candidateSha256,
    reviewDecisionSha256: sha256(reviewBytes),
    institutionId: review.manifest.institutionId,
    destinationPath: destination.path,
    manifestSha256: sha256(manifestBody),
    sources: review.manifest.sources.length,
    reconciliationEntries: review.manifest.catalogReconciliation.entries.length,
    qualityGate: {
      catalogReconciliationComplete: true,
      pendingEntries: 0,
      discoveryPendingCoverage: 0,
      auditOnlyMarkers: 0,
    },
  };
}

export function parseSourceManifestPromotionCli(argv: string[]): PromotionCli {
  let artifactDirectory: string | undefined;
  let reviewDecisionPath: string | undefined;
  let write = false;
  const seen = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (seen.has(argument)) {
      throw new Error("Duplicate CLI option: " + argument + "\n" + CLI_USAGE);
    }
    seen.add(argument);
    if (argument === "--write") {
      write = true;
      continue;
    }
    if (argument !== "--artifact" && argument !== "--review-decision") {
      throw new Error("Unknown CLI option: " + argument + "\n" + CLI_USAGE);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("Missing value for " + argument + "\n" + CLI_USAGE);
    }
    index += 1;
    if (argument === "--artifact") artifactDirectory = value;
    if (argument === "--review-decision") reviewDecisionPath = value;
  }

  if (!artifactDirectory || !reviewDecisionPath) throw new Error(CLI_USAGE);
  return { artifactDirectory, reviewDecisionPath, write };
}

function runCli(): void {
  const cli = parseSourceManifestPromotionCli(process.argv.slice(2));
  process.stdout.write(
    JSON.stringify(promoteSourceManifestCandidate(cli)) + "\n",
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
