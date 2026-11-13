import assert from "node:assert/strict";
import { test } from "node:test";
import { ccc } from "@ckb-ccc/core";
import { transactionUsesLockInput } from "../../frontend/src/lib/vellum";

const expectedLock = ccc.Script.from({
  codeHash: `0x${"11".repeat(32)}`,
  hashType: "type",
  args: `0x${"22".repeat(20)}`,
});
const otherLock = ccc.Script.from({
  codeHash: `0x${"33".repeat(32)}`,
  hashType: "type",
  args: `0x${"44".repeat(20)}`,
});

function transactionWithInput(lock: ccc.Script): ccc.Transaction {
  return ccc.Transaction.from({
    inputs: [
      {
        previousOutput: { txHash: `0x${"55".repeat(32)}`, index: 0 },
        cellOutput: { capacity: 100_000_000n, lock },
        outputData: "0x",
      },
    ],
  });
}

test("campaign creation input authorization checks the complete transaction", async () => {
  const client = {} as ccc.Client;
  assert.equal(
    await transactionUsesLockInput(client, transactionWithInput(expectedLock), expectedLock),
    true,
  );
  assert.equal(
    await transactionUsesLockInput(client, transactionWithInput(otherLock), expectedLock),
    false,
  );
});
