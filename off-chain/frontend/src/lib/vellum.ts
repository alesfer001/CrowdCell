import { ccc } from "@ckb-ccc/core";
import { listDidCkbsByLock, resolveDidCkb } from "@ckb-ccc/did-ckb";

export type ControlledVellumDid = {
  did: string;
  displayName?: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function displayNameFromDocument(document: unknown): string | undefined {
  const services = record(record(document)?.services);
  const profile = record(services?.profile);
  if (profile?.type !== "VellumProfile" || typeof profile.displayName !== "string") {
    return undefined;
  }
  const displayName = profile.displayName.trim();
  return displayName && displayName.length <= 100 ? displayName : undefined;
}

export async function resolveVellumDid(
  client: ccc.Client,
  did: string,
): Promise<ControlledVellumDid | undefined> {
  const identity = await resolveDidCkb({ client, did });
  if (!identity) return undefined;
  return {
    did: identity.did,
    displayName:
      identity.data.type === "v1"
        ? displayNameFromDocument(identity.data.value.document)
        : undefined,
  };
}

/** Lists live did:ckb identities whose current controller is the supplied wallet lock. */
export async function listControlledVellumDids(
  client: ccc.Client,
  lock: ccc.ScriptLike,
): Promise<ControlledVellumDid[]> {
  const identities = await listDidCkbsByLock({ client, lock });
  return identities
    .map((identity) => ({
      did: identity.did,
      displayName:
        identity.data.type === "v1"
          ? displayNameFromDocument(identity.data.value.document)
          : undefined,
    }))
    .sort((left, right) =>
      (left.displayName ?? left.did).localeCompare(right.displayName ?? right.did),
    );
}

export function vellumDidLabel(identity: ControlledVellumDid): string {
  return identity.displayName ? `${identity.displayName} - ${identity.did}` : identity.did;
}
