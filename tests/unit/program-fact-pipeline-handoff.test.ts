import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildProgramFactPipelineHandoff } from "../../scripts/ingestion/build-program-fact-pipeline-handoff";

function source(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    id: "example-program-source",
    institutionId: "uni-example",
    entityType: "program",
    sourceCategory: "program_detail",
    officialUrl: "https://admissions.example.edu.cn/program#details",
    allowedHosts: ["admissions.example.edu.cn"],
    enabled: true,
    schedule: { intervalHours: 168 },
    fetch: {},
    robots: { mode: "enforce" },
    extraction: {
      mode: "minimax",
      schemaVersion: "program-facts-v1",
      fields: [
        { path: "program", type: "object", required: true, critical: true },
      ],
    },
    ...overrides,
  };
}

describe("program fact Pipeline handoff", () => {
  it("queues only exact registered AI sources for the same institution", () => {
    const handoff = buildProgramFactPipelineHandoff({
      generatedAt: "2026-08-26T00:00:00.000Z",
      audit: {
        records: [
          {
            institutionId: "uni-example",
            officialUrl: "https://admissions.example.edu.cn/program",
            programId: "program-one",
            status: "enriched",
          },
          {
            institutionId: "uni-example",
            officialUrl: "https://admissions.example.edu.cn/program",
            programId: "program-two",
            status: "fetch-failed",
          },
          {
            institutionId: "uni-example",
            officialUrl: "https://admissions.example.edu.cn/unregistered",
            programId: "program-three",
            status: "no-grounded-facts",
          },
        ],
      },
      sourceManifestDocuments: [
        {
          version: 2,
          sources: [
            source(),
            source({ id: "wrong-institution", institutionId: "uni-other" }),
            source({
              id: "rules-only",
              extraction: {
                mode: "rules-only",
                schemaVersion: "rules-v1",
                fields: [{ path: "program", type: "object" }],
              },
            }),
            source({ id: "scholarship-source", entityType: "scholarship" }),
            source({ id: "disabled-source", enabled: false }),
          ],
        },
      ],
    });

    expect(handoff.policy).toEqual({
      exactOfficialUrlMatch: true,
      aiWritesCatalog: false,
      pipelineCandidateOnly: true,
    });
    expect(handoff.requests).toEqual([
      {
        sourceId: "example-program-source",
        institutionId: "uni-example",
        officialUrl: "https://admissions.example.edu.cn/program",
        entityType: "program",
        sourceCategory: "program_detail",
        extractionMode: "minimax",
        programIds: ["program-one", "program-two"],
        auditStatuses: ["enriched", "fetch-failed"],
      },
    ]);
    expect(handoff.unmatchedOfficialUrls).toEqual([
      "https://admissions.example.edu.cn/unregistered",
    ]);
    expect(handoff.summary).toMatchObject({
      auditedRecords: 3,
      auditedOfficialUrls: 2,
      requests: 1,
      unmatchedOfficialUrls: 1,
    });
  });

  it("rejects untrusted audit URLs and non-V2 manifest documents", () => {
    expect(() =>
      buildProgramFactPipelineHandoff({
        audit: {
          records: [
            {
              institutionId: "uni-example",
              officialUrl: "http://admissions.example.edu.cn/program",
              programId: "program-one",
              status: "fetch-failed",
            },
          ],
        },
        sourceManifestDocuments: [{ version: 2, sources: [source()] }],
      }),
    ).toThrow(/credential-free HTTPS/u);

    expect(() =>
      buildProgramFactPipelineHandoff({
        audit: { records: [] },
        sourceManifestDocuments: [{ version: 1, sources: [] }],
      }),
    ).toThrow(/must be a V2 wrapper/u);
  });

  it("wires weekly refresh into Pipeline re-verification without a Catalog write path", () => {
    const workflow = readFileSync(
      resolve(process.cwd(), ".github/workflows/program-fact-refresh.yml"),
      "utf8",
    );
    const buildHandoff = workflow.indexOf(
      "- name: Build Pipeline re-verification handoff",
    );
    const enqueue = workflow.indexOf(
      "- name: Enqueue registered sources for Pipeline AI verification",
    );
    const validate = workflow.indexOf("- name: Validate refreshed Catalog");
    const handoffUpload = workflow.indexOf(
      "- name: Upload Pipeline re-verification handoff",
    );
    const strictSignal = workflow.indexOf(
      "- name: Preserve Pipeline enqueue health signal",
    );

    expect(buildHandoff).toBeGreaterThan(-1);
    expect(enqueue).toBeGreaterThan(buildHandoff);
    expect(handoffUpload).toBeGreaterThan(enqueue);
    expect(validate).toBeGreaterThan(handoffUpload);
    expect(strictSignal).toBeGreaterThan(validate);
    expect(workflow).toContain(
      "INGESTION_WORKER_URL: ${{ vars.INGESTION_WORKER_URL }}",
    );
    expect(workflow).toContain(
      "INGESTION_ADMIN_TOKEN: ${{ secrets.INGESTION_ADMIN_TOKEN }}",
    );
    expect(workflow).toContain("and .policy.aiWritesCatalog == false");
    expect(workflow).toContain('.error == "source_already_queued"');
    expect(workflow).toContain("the replayable handoff artifact was retained");
    expect(workflow).not.toContain("request-materialization-release");
    expect(workflow).not.toContain("wrangler d1 execute studyinchina-catalog");
  });
});
