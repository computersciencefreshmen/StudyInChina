export type MigrationConfigOptions = { sourceAccountId: string; targetAccountId: string; pipelineId: string; catalogId: string;
  metadataDirectory: string; catalogMetadataPath: string; migrationId: string; outputDirectory: string }
export type MigrationConfigManifest = {
  format: string; version: number; sourceAccountId: string; targetAccountId: string; migrationId: string; sha256: string;
  databases: Array<{ databaseName: string; sourceId: string; targetId: string }>;
  workers: Array<{ worker: string; name: string; sourceVersionId: string; sourceConfigSha256: string; sourceMetadataSha256: string;
    sourceMetadataAccountVerifiedByThisOfflineTool: boolean; sourceBindingResourcesVerified: boolean; resourceBindings: Array<Record<string, unknown>>;
    livePlainTextVarNames: string[]; removedTemporaryVarNames: string[]; providerSecretNames: string[]; internallyGeneratableSecretNames: string[];
    otherManualSecretNames: string[]; requiredTargetSecretNames: string[]; targetSecretsProvisioned: boolean;
    triggers: { source: string; liveSettingsVerified: boolean; crons: string[]; consumers: Array<Record<string, unknown>> };
    files: Array<{ stage: string; name: string; sha256: string; bytes: number }> }>;
  activation: { stagedHasNoCronSchedules: boolean; stagedHasNoConsumerConfigs: boolean; existingTargetConsumersMustBeDetached: boolean;
    activeRequiresReplaceVars: boolean; keepVars: boolean; secretValuesIncluded: boolean; targetResourcesExistenceVerified: boolean;
    requiresModelStateFinalized: boolean; requiresDataAndEvidenceVerified: boolean; cloudMutationPerformed: boolean; cutoverReady: boolean };
}
export function buildAccountMigrationConfigs(options: MigrationConfigOptions): MigrationConfigManifest
