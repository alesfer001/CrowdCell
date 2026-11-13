"use client";

import { useEffect, useState } from "react";
import { useDevnet } from "@/components/DevnetContext";
import { resolveVellumDid, type ControlledVellumDid } from "@/lib/vellum";

type VellumIdentityLinkProps = {
  did: string;
};

export function VellumIdentityLink({ did }: VellumIdentityLinkProps) {
  const { client } = useDevnet();
  const [resolution, setResolution] = useState<{
    client: typeof client;
    did: string;
    identity?: ControlledVellumDid;
  }>();

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void resolveVellumDid(client, did)
      .then((resolved) => {
        if (!cancelled) setResolution({ client, did, identity: resolved });
      })
      .catch(() => {
        if (!cancelled) setResolution({ client, did });
      });
    return () => {
      cancelled = true;
    };
  }, [client, did]);

  const identity =
    resolution?.client === client && resolution.did === did
      ? resolution.identity
      : undefined;

  return (
    <a
      href={`https://usevellum.xyz/profile/${encodeURIComponent(did)}`}
      target="_blank"
      rel="noreferrer"
      className="block text-blue-600 hover:underline"
    >
      {identity?.displayName && <span className="block font-medium">{identity.displayName}</span>}
      <span className="block font-mono text-sm break-all">{did}</span>
    </a>
  );
}
