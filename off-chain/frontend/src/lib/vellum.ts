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
  const isSafe = [...displayName].every((character) => {
    const code = character.codePointAt(0)!;
    return code > 0x1f && code !== 0x7f && (code < 0xd800 || code > 0xdfff);
  });
  return displayName && displayName.length <= 100 && isSafe ? displayName : undefined;
}

export async function transactionUsesLockInput(
  client: ccc.Client,
  transaction: ccc.Transaction,
  lock: ccc.ScriptLike,
): Promise<boolean> {
  const expected = ccc.Script.from(lock);
  for (const input of transaction.inputs) {
    const cell = await input.getCell(client);
    if (cell.cellOutput.lock.eq(expected)) return true;
  }
  return false;
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
