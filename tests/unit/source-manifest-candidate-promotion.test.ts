import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSourceManifestCohort,
  CURRENT_SOURCE_MANIFEST_COHORT_INPUTS,
  SOURCE_MANIFEST_COHORT_RECONCILIATION_DIRECTORY,
  writeSourceManifestCohort,
  type BuildSourceManifestCohortInput,
  type SourceManifestCohortArtifactManifest,
  type SourceManifestCohortInputFingerprint,
} from "../../scripts/ingestion/build-source-manifest-cohort";
import {
  parseSourceManifestPromotionCli,
  promoteSourceManifestCandidate,
  type SourceManifestPromotionReview,
} from "../../scripts/ingestion/promote-source-manifest-candidate";
import type { SourceManifestV2 } from "../../scripts/source-manifest-registry";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function temporaryRepository(): string {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "manifest-promotion-"));
  temporaryDirectories.push(repositoryRoot);
  mkdirSync(join(repositoryRoot, "content/source-manifests"), {
    recursive: true,
  });
  mkdirSync(join(repositoryRoot, "content/data"), { recursive: true });
  writeFileSync(
    join(repositoryRoot, "content/data/universities.json"),
    JSON.stringify([{ id: "uni-test-university" }]),
    "utf8",
  );
  return repositoryRoot;
}

function cohortFixture(): BuildSourceManifestCohortInput {
  return {
    checkedAt: "2026-08-06",
    registry: {
      cohort: { id: "promotion-test-cohort" },
      targets: [
        {
          targetId: "target-001",
          ordinal: 1,
          officialNameZh: "测试大学",
          catalogInstitutionId: "uni-test-university",
        },
      ],
    },
    universities: [
      {
        id: "uni-test-university",
        slug: "test-university",
        name: { en: "Test University", zh: "测试大学" },
        sourceIds: [],
      },
    ],
    sources: [
      {
        id: "src-test-program",
        url: "https://international.test.edu.cn/programs/master",
        title: "Official international programme",
        kind: "program",
        official: true,
      },
    ],
    programs: [
      {
        id: "program-test-master",
        universityId: "uni-test-university",
        name: { en: "Verified Master Programme" },
        sourceIds: ["src-test-program"],
      },
    ],
    admissionCycles: [],
    scholarships: [],
    sourceReconciliations: [],
  };
}

function inputFingerprints(): SourceManifestCohortInputFingerprint[] {
  const locked = (
    Object.keys(CURRENT_SOURCE_MANIFEST_COHORT_INPUTS) as Array<
      keyof typeof CURRENT_SOURCE_MANIFEST_COHORT_INPUTS
    >
  ).map((name, index): SourceManifestCohortInputFingerprint => ({
    name,
    repositoryPath: CURRENT_SOURCE_MANIFEST_COHORT_INPUTS[name],
    sha256: (index + 1).toString(16).padStart(64, "0"),
    byteLength: index + 1,
  }));
  return [
    ...locked,
    {
      name: "sourceReconciliation:test.v1.json",
      repositoryPath: `${SOURCE_MANIFEST_COHORT_RECONCILIATION_DIRECTORY}/test.v1.json`,
      sha256: "7".padStart(64, "0"),
      byteLength: 7,
    },
  ];
}

function completeManifest(candidate: SourceManifestV2): SourceManifestV2 {
  return {
    ...structuredClone(candidate),
    manifestStatus: "complete",
    sources: candidate.sources.map((source) => ({
      ...source,
      enabled: true,
      robots: { mode: "enforce" },
    })),
    coverage: candidate.coverage.map((coverage) =>
      coverage.sourceIds?.length
        ? {
            sourceCategory: coverage.sourceCategory,
            status: "registered" as const,
            sourceIds: [...coverage.sourceIds],
          }
        : {
            sourceCategory: coverage.sourceCategory,
            status: "officially_not_provided" as const,
            note: "A named reviewer resolved this category from official evidence.",
          },
    ),
    catalogReconciliation: {
      ...structuredClone(candidate.catalogReconciliation),
      scope: "full_official_catalog",
      status: "complete",
      entries: candidate.catalogReconciliation.entries.map((entry, index) => ({
        ...entry,
        status: "published" as const,
        recordId: `program-reviewed-${index + 1}`,
        note: undefined,
      })),
      note: "Every official catalog entry was resolved during evidence review.",
    },
  };
}

function setupPromotion(options: { auditOnly?: boolean } = {}): {
  artifactDirectory: string;
  candidatePath: string;
  candidateFilePath: string;
  destinationPath: string;
  repositoryRoot: string;
  reviewDecisionPath: string;
  review: SourceManifestPromotionReview;
} {
  const repositoryRoot = temporaryRepository();
  const build = buildSourceManifestCohort(cohortFixture());
  const candidate = build.candidates[0]!;
  if (options.auditOnly) {
    candidate.manifest.catalogReconciliation.entries[0] = {
      ...candidate.manifest.catalogReconciliation.entries[0]!,
      officialKey: "audit-only:uni-test-university:international-catalog",
      officialName: "AUDIT ONLY - not a publishable programme",
    };
  }
  const artifactDirectory = join(repositoryRoot, "candidate-bundle");
  writeSourceManifestCohort(
    build,
    artifactDirectory,
    inputFingerprints(),
    repositoryRoot,
  );
  const artifact = JSON.parse(
    readFileSync(join(artifactDirectory, "artifact-manifest.v1.json"), "utf8"),
  ) as SourceManifestCohortArtifactManifest;
  const candidateFile = artifact.files.find((file) =>
    file.path.startsWith("manifests/"),
  )!;
  const candidateFilePath = join(
    artifactDirectory,
    ...candidateFile.path.split("/"),
  );
  const reviewedManifest = completeManifest(candidate.manifest);
  const review: SourceManifestPromotionReview = {
    format: "studyinchina.source-manifest-v2-promotion-review",
    formatVersion: 1,
    decision: "approve_complete_manifest",
    reviewedAt: "2026-08-06",
    reviewer: "reviewer@example.test",
    rationale:
      "Official evidence was inspected and every catalog outcome was resolved.",
    artifact: {
      cohortId: artifact.cohortId,
      candidatePath: candidateFile.path,
      candidateSha256: candidateFile.sha256,
    },
    manifest: reviewedManifest,
  };
  const reviewDecisionPath = join(repositoryRoot, "review-decision.json");
  writeFileSync(
    reviewDecisionPath,
    JSON.stringify(review, null, 2) + "\n",
    "utf8",
  );
  const destinationPath = join(
    repositoryRoot,
    "content/source-manifests/double-first-class/institutions",
    candidate.fileName.replace(".v2.candidate.json", ".v2.json"),
  );
  return {
    artifactDirectory,
    candidatePath: candidateFile.path,
    candidateFilePath,
    destinationPath,
    repositoryRoot,
    reviewDecisionPath,
    review,
  };
}

describe("SourceManifestV2 candidate promotion gate", () => {
  it("is dry-run by default and writes one complete formal manifest only with --write", () => {
    const setup = setupPromotion();

    const dryRun = promoteSourceManifestCandidate({
      artifactDirectory: setup.artifactDirectory,
      reviewDecisionPath: setup.reviewDecisionPath,
      repositoryRoot: setup.repositoryRoot,
    });

    expect(dryRun).toMatchObject({
      mode: "dry-run",
      institutionId: "uni-test-university",
      candidatePath: setup.candidatePath,
      qualityGate: {
        catalogReconciliationComplete: true,
        pendingEntries: 0,
        discoveryPendingCoverage: 0,
        auditOnlyMarkers: 0,
      },
    });
    expect(existsSync(setup.destinationPath)).toBe(false);

    const written = promoteSourceManifestCandidate({
      artifactDirectory: setup.artifactDirectory,
      reviewDecisionPath: setup.reviewDecisionPath,
      repositoryRoot: setup.repositoryRoot,
      write: true,
    });

    expect(written.mode).toBe("write");
    expect(JSON.parse(readFileSync(setup.destinationPath, "utf8"))).toEqual(
      setup.review.manifest,
    );
    expect(() =>
      promoteSourceManifestCandidate({
        artifactDirectory: setup.artifactDirectory,
        reviewDecisionPath: setup.reviewDecisionPath,
        repositoryRoot: setup.repositoryRoot,
        write: true,
      }),
    ).toThrow(/Refusing to overwrite/);
  });

  it("verifies the whole artifact before accepting the exact reviewed candidate SHA", () => {
    const setup = setupPromotion();
    writeFileSync(setup.candidateFilePath, "{}\n", "utf8");

    expect(() =>
      promoteSourceManifestCandidate({
        artifactDirectory: setup.artifactDirectory,
        reviewDecisionPath: setup.reviewDecisionPath,
        repositoryRoot: setup.repositoryRoot,
      }),
    ).toThrow(/checksum mismatch/);

    const exactShaSetup = setupPromotion();
    exactShaSetup.review.artifact.candidateSha256 = sha256(
      Buffer.from("wrong"),
    );
    writeFileSync(
      exactShaSetup.reviewDecisionPath,
      JSON.stringify(exactShaSetup.review, null, 2) + "\n",
      "utf8",
    );
    expect(() =>
      promoteSourceManifestCandidate({
        artifactDirectory: exactShaSetup.artifactDirectory,
        reviewDecisionPath: exactShaSetup.reviewDecisionPath,
        repositoryRoot: exactShaSetup.repositoryRoot,
      }),
    ).toThrow(/candidateSha256/);
  });

  it("rejects audit-only synthetic entries and incomplete reviewed manifests", () => {
    const auditOnly = setupPromotion({ auditOnly: true });
    expect(() =>
      promoteSourceManifestCandidate({
        artifactDirectory: auditOnly.artifactDirectory,
        reviewDecisionPath: auditOnly.reviewDecisionPath,
        repositoryRoot: auditOnly.repositoryRoot,
      }),
    ).toThrow(/AUDIT ONLY/);

    const incomplete = setupPromotion();
    incomplete.review.manifest.manifestStatus = "in_progress";
    incomplete.review.manifest.catalogReconciliation.status = "in_progress";
    writeFileSync(
      incomplete.reviewDecisionPath,
      JSON.stringify(incomplete.review, null, 2) + "\n",
      "utf8",
    );
    expect(() =>
      promoteSourceManifestCandidate({
        artifactDirectory: incomplete.artifactDirectory,
        reviewDecisionPath: incomplete.reviewDecisionPath,
        repositoryRoot: incomplete.repositoryRoot,
      }),
    ).toThrow(/requires a complete manifest/);
  });

  it("rejects representative discovery mislabeled as complete reconciliation", () => {
    const representative = setupPromotion();
    representative.review.manifest.catalogReconciliation.scope =
      "representative_international_programs";
    writeFileSync(
      representative.reviewDecisionPath,
      JSON.stringify(representative.review, null, 2) + "\n",
      "utf8",
    );

    expect(() =>
      promoteSourceManifestCandidate({
        artifactDirectory: representative.artifactDirectory,
        reviewDecisionPath: representative.reviewDecisionPath,
        repositoryRoot: representative.repositoryRoot,
      }),
    ).toThrow(
      /representative_international_programs cannot claim complete catalog reconciliation/,
    );
  });

  it("rejects a second formal manifest for the same institution", () => {
    const setup = setupPromotion();
    const existingDirectory = join(
      setup.repositoryRoot,
      "content/source-manifests/existing",
    );
    mkdirSync(existingDirectory, { recursive: true });
    writeFileSync(
      join(existingDirectory, "same-school.v2.json"),
      JSON.stringify(setup.review.manifest, null, 2) + "\n",
      "utf8",
    );

    expect(() =>
      promoteSourceManifestCandidate({
        artifactDirectory: setup.artifactDirectory,
        reviewDecisionPath: setup.reviewDecisionPath,
        repositoryRoot: setup.repositoryRoot,
      }),
    ).toThrow(/already exists for institutionId/);
  });

  it("has no output path option and requires an explicit review decision", () => {
    expect(
      parseSourceManifestPromotionCli([
        "--artifact",
        "candidate-bundle",
        "--review-decision",
        "review.json",
      ]),
    ).toEqual({
      artifactDirectory: "candidate-bundle",
      reviewDecisionPath: "review.json",
      write: false,
    });
    expect(
      parseSourceManifestPromotionCli([
        "--artifact",
        "candidate-bundle",
        "--review-decision",
        "review.json",
        "--write",
      ]).write,
    ).toBe(true);
    expect(() =>
      parseSourceManifestPromotionCli([
        "--artifact",
        "candidate-bundle",
        "--output",
        "../outside",
        "--review-decision",
        "review.json",
      ]),
    ).toThrow(/Unknown CLI option/);
    expect(() =>
      parseSourceManifestPromotionCli(["--artifact", "candidate-bundle"]),
    ).toThrow(/Usage/);
  });

  it("rejects calendar-normalized review dates such as February 31", () => {
    const setup = setupPromotion();
    setup.review.reviewedAt = "2026-02-31";
    writeFileSync(
      setup.reviewDecisionPath,
      JSON.stringify(setup.review, null, 2) + "\n",
      "utf8",
    );

    expect(() =>
      promoteSourceManifestCandidate({
        artifactDirectory: setup.artifactDirectory,
        reviewDecisionPath: setup.reviewDecisionPath,
        repositoryRoot: setup.repositoryRoot,
      }),
    ).toThrow(/reviewedAt must be a real ISO calendar date/);
  });
});
