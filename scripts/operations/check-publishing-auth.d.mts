export type PublishingAuthenticationReadback = {
  authenticatedReadsPassed: true
  checkedAt: string
  projectId: string
  ownerId: string
  deploymentId: string
  controlEnabled: true
  revision: number
  commandStatus: string | null
  cloudMutations: 0
  limitation: string
}
export function checkPublishingAuthentication(
  environment?: Record<string, string | undefined>,
  transport?: typeof fetch,
): Promise<PublishingAuthenticationReadback>
