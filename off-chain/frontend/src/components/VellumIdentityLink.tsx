"use client";

import { useEffect, useState } from "react";
import { useDevnet } from "@/components/DevnetContext";
import { resolveVellumDid, type ControlledVellumDid } from "@/lib/vellum";

type VellumIdentityLinkProps = {
  did: string;
};

export function VellumIdentityLink({ did }: VellumIdentityLinkProps) {
  const { client } = useDevnet();
  const [identity, setIdentity] = useState<ControlledVellumDid>();

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void resolveVellumDid(client, did)
      .then((resolved) => {
        if (!cancelled) setIdentity(resolved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, did]);

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
