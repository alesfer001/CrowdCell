import { test } from "node:test";
import assert from "node:assert/strict";
import { ccc } from "@ckb-ccc/core";
import { CellNameResolver, MAX_LOCKS_PER_REQUEST, parseCellNameRequest } from "../src/cellNames";

const SECP = "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8";
const lock = (n: number) => ({ codeHash: SECP, hashType: "type", args: "0x" + n.toString(16).padStart(40, "0") });
const hashOf = (l: ReturnType<typeof lock>) =>
  ccc.Script.from({ codeHash: l.codeHash, hashType: "type", args: l.args }).hash().toLowerCase();
const addressOf = (l: ReturnType<typeof lock>) =>
  new ccc.Address(ccc.Script.from({ codeHash: l.codeHash, hashType: "type", args: l.args }), "ckt").toString();

/** A fake upstream that names the given addresses and counts calls. */
function upstream(names: Record<string, string | null>, opts: { fail?: boolean } = {}) {
  const calls: string[][] = [];
  const fetchFn = async (_url: string, init: RequestInit) => {
    const { addresses } = JSON.parse(init.body as string) as { addresses: string[] };
    calls.push(addresses);
    if (opts.fail) throw new Error("down");
    return new Response(JSON.stringify({ results: addresses.map((a) => ({ address: a, name: names[a] ?? null })) }));
  };
  return { fetchFn, calls };
}

test("parseCellNameRequest accepts well-formed locks", () => {
  const r = parseCellNameRequest({ locks: [lock(1)] });
  assert.ok("locks" in r && r.locks.length === 1);
});

test("parseCellNameRequest refuses bad input", () => {
  assert.ok("error" in parseCellNameRequest(null));
  assert.ok("error" in parseCellNameRequest({ locks: "x" }));
  assert.ok("error" in parseCellNameRequest({ locks: [{ ...lock(1), codeHash: "0x12" }] }));
  assert.ok("error" in parseCellNameRequest({ locks: [{ ...lock(1), hashType: "nope" }] }));
  assert.ok("error" in parseCellNameRequest({ locks: [{ ...lock(1), args: "0x" + "ab".repeat(129) }] }));
  assert.ok("error" in parseCellNameRequest({ locks: [{ ...lock(1), args: "0xabc" }] }));
  const tooMany = Array.from({ length: MAX_LOCKS_PER_REQUEST + 1 }, (_, i) => lock(i));
  assert.ok("error" in parseCellNameRequest({ locks: tooMany }));
});

test("names come back by lock hash, invalid and expired names are dropped", async () => {
  const [a, b, c, d] = [lock(1), lock(2), lock(3), lock(4)];
  const { fetchFn } = upstream({ [addressOf(a)]: "alice.cell", [addressOf(b)]: "Not A Name", [addressOf(c)]: null });
  const resolver = new CellNameResolver("testnet", async (url, init) => {
    const res = await fetchFn(url, init);
    const body = (await res.json()) as { results: { address: string; name: string | null; expired?: boolean }[] };
    for (const r of body.results) if (r.address === addressOf(d)) Object.assign(r, { name: "old.cell", expired: true });
    return new Response(JSON.stringify(body));
  });
  const names = await resolver.lookup([a, b, c, d]);
  assert.deepEqual(names, { [hashOf(a)]: "alice.cell", [hashOf(b)]: null, [hashOf(c)]: null, [hashOf(d)]: null });
});

test("answers are cached until they expire", async () => {
  let now = 0;
  const a = lock(1);
  const { fetchFn, calls } = upstream({ [addressOf(a)]: "alice.cell" });
  const resolver = new CellNameResolver("testnet", fetchFn, () => now);
  await resolver.lookup([a]);
  await resolver.lookup([a]);
  assert.equal(calls.length, 1);
  now += 11 * 60 * 1000;
  await resolver.lookup([a]);
  assert.equal(calls.length, 2);
});

test("upstream batches are at most 50 addresses", async () => {
  const locks = Array.from({ length: 120 }, (_, i) => lock(i));
  const { fetchFn, calls } = upstream({});
  await new CellNameResolver("testnet", fetchFn).lookup(locks);
  assert.deepEqual(calls.map((c) => c.length), [50, 50, 20]);
});

test("a failed upstream leaves locks out, and they are asked again next time", async () => {
  const a = lock(1);
  const down = upstream({}, { fail: true });
  const resolver = new CellNameResolver("testnet", down.fetchFn);
  assert.deepEqual(await resolver.lookup([a]), {});
  await resolver.lookup([a]);
  assert.equal(down.calls.length, 2);
});

test("devnet asks nobody", async () => {
  const { fetchFn, calls } = upstream({});
  assert.deepEqual(await new CellNameResolver("devnet", fetchFn).lookup([lock(1)]), {});
  assert.equal(calls.length, 0);
});
