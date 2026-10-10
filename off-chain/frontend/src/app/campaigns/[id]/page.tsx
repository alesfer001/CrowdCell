"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ccc } from "@ckb-ccc/connector-react";
import { Campaign, Pledge, CampaignStatus, Receipt, PledgeDistributionStatus, IndexerPhase } from "@/lib/types";
import { fetchCampaign, fetchPledgesForCampaign, fetchBlockNumber, fetchReceiptsForCampaign } from "@/lib/api";
import {
  shannonsToCKB,
  ckbToShannons,
  formatHash,
  getEffectiveStatusLabel,
  getEffectiveStatusColor,
  getFundingProgress,
  blocksToTimeEstimate,
  blockToRelativeTime,
  blockNumberToDate,
  getPledgeDistributionLabel,
  getPledgeDistributionColor,
  getExplorerTxUrl,
  getDistributionSummary,
  calculateCostBreakdown,
  formatCost,
} from "@/lib/utils";
import { CONTRACTS, MIN_PLEDGE_CKB, PLEDGE_CELL_OVERHEAD, RECEIPT_CELL_CAPACITY, EXPLORER_URL, GRACE_PERIOD_BLOCKS } from "@/lib/constants";
import {
  u64ToHexLE,
  serializeMetadataHex,
  readTotalPledged,
  readFundingGoal,
  readCampaignStatus,
  withTotalPledged,
  withCampaignStatus,
} from "@/lib/serialization";
import { useDevnet } from "@/components/DevnetContext";
import { useToast } from "@/components/Toast";
import { SkeletonDetailPage } from "@/components/Skeleton";
import { useIndexerReady, IndexerWaitNotice } from "@/components/IndexerStatus";
import { LockName, useCellNames } from "@/components/CellName";

type PledgeSortMode = "recent" | "amount";

/** Pledge attempts before giving up when other pledges keep winning the campaign cell */
const PLEDGE_ATTEMPTS = 3;

/** How long to wait for the winning pledge to commit before rebuilding anyway */
const CAMPAIGN_CELL_MOVE_TIMEOUT_MS = 30000;

/**
 * Did the pledge fail because an input it spends is already spent or pending?
 * Since v1.2 every pledge consumes the campaign cell, so two pledges at once race for it.
 * While the winner is still in the pool the node rejects the loser as a failed RBF (either
 * "fee too low to replace" or "contains unconfirmed inputs"); once the winner commits, the
 * spent cell resolves as unknown. The unknown case also covers JoyID's stale wallet cells
 * (Phase 17.7), which a rebuild fixes the same way.
 */
function isInputAlreadySpentError(error: unknown): boolean {
  if (error instanceof ccc.ErrorClientResolveUnknown || error instanceof ccc.ErrorClientRBFRejected) {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("Unknown(OutPoint(") || msg.includes("Dead(OutPoint(") || msg.includes("PoolRejectedRBF");
}

/**
 * Resolve the campaign's live cell and its on-chain data.
 *
 * Since v1.2 every pledge consumes and re-creates the campaign cell, so the out point the
 * indexer last saw can already be dead. The type script (TypeID + pledge-lock code hash)
 * is fixed for the life of the campaign, so it is read from the last known out point —
 * historical transactions stay resolvable — and used to search for the live cell.
 */
async function resolveLiveCampaignCell(client: any, campaignId: string) {
  const [knownTxHash, knownIndex] = campaignId.split("_");
  const knownTx = await client.getTransaction(knownTxHash);
  const knownOutput = knownTx?.transaction?.outputs?.[parseInt(knownIndex)];
  if (!knownOutput?.type) {
    throw new Error("Campaign cell not found. It may have been destroyed.");
  }
  const typeScript = ccc.Script.from(knownOutput.type);

  // Query the chain, not the client cache: the cache keeps returning a campaign cell this
  // wallet created (by pledging) even after another pledge or the bot's finalization spent it
  for await (const cell of client.findCellsOnChain(
    { script: typeScript, scriptType: "type" as const, scriptSearchMode: "exact" as const, withData: true },
    "asc",
    1
  )) {
    return { cell, typeScript, typeScriptHash: typeScript.hash() };
  }
  throw new Error("Campaign is no longer live on chain");
}

/**
 * Wait until the campaign cell has moved past a spent out point, so a rebuilt pledge
 * does not pick the same dead cell again. Gives up quietly after a timeout: when the cell
 * never moves the failure was a stale wallet cell, and rebuilding is still the fix.
 */
async function waitForCampaignCellToMove(client: ccc.Client, campaignId: string, spent: ccc.OutPoint) {
  const deadline = Date.now() + CAMPAIGN_CELL_MOVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const { cell } = await resolveLiveCampaignCell(client, campaignId);
    if (!cell.outPoint.eq(spent)) return;
  }
}

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;
  const { open } = ccc.useCcc();
  const walletSigner = ccc.useSigner();
  const { isDevnet, devnetSigner } = useDevnet();
  const { toast } = useToast();
  const { phase: indexerPhase, elapsedSeconds, retry: retryIndexer } = useIndexerReady();

  const signer = isDevnet ? devnetSigner : walletSigner;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const names = useCellNames([campaign?.creatorLockScript, ...pledges.map((p) => p.backerLockScript)]);
  const [currentBlock, setCurrentBlock] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pledge form state
  const [pledgeAmount, setPledgeAmount] = useState("");
  const [pledging, setPledging] = useState(false);
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [pledgeTxHash, setPledgeTxHash] = useState<string | null>(null);

  // Action state
  const [actionLoading, setActionLoading] = useState(false);
  const [actionTxHash, setActionTxHash] = useState<string | null>(null);
  const [walletLockHash, setWalletLockHash] = useState<string | null>(null);
  const [reclaiming, setReclaiming] = useState(false);

  // UI state
  const [showCampaignId, setShowCampaignId] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const [pledgeSortMode, setPledgeSortMode] = useState<PledgeSortMode>("recent");
  const [txProgress, setTxProgress] = useState<"submitted" | "pending" | "confirmed" | null>(null);

  // Get wallet lock hash when signer changes
  useEffect(() => {
    async function getWalletInfo() {
      if (!signer) {
        setWalletLockHash(null);
        return;
      }
      try {
        const address = await signer.getRecommendedAddress();
        const client = signer.client;
        const addressObj = await ccc.Address.fromString(address, client);
        const lockHash = addressObj.script.hash();
        setWalletLockHash(lockHash);
      } catch {
        setWalletLockHash(null);
      }
    }
    getWalletInfo();
  }, [signer]);

  const loadData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    if (!isRefresh) setError(null);

    try {
      const [campaignData, pledgesData, blockNum, receiptsData] = await Promise.all([
        fetchCampaign(campaignId),
        fetchPledgesForCampaign(campaignId),
        fetchBlockNumber(),
        fetchReceiptsForCampaign(campaignId).catch(() => [] as Receipt[]),
      ]);

      if (!campaignData) {
        if (!isRefresh) setError("Campaign not found");
      } else {
        setCampaign(campaignData);
        setPledges(pledgesData);
        setCurrentBlock(blockNum);
        setReceipts(receiptsData);
      }
    } catch (err) {
      if (!isRefresh) {
        setError(err instanceof Error ? err.message : "Failed to load campaign");
      }
    } finally {
      if (!isRefresh) setLoading(false);
    }
  }, [campaignId]);

  // Hold the first load until the indexer has synced, otherwise a
  // shared link opened during a cold start reads as "Campaign not found"
  useEffect(() => {
    if (indexerPhase !== IndexerPhase.Ready) return;
    loadData();
  }, [indexerPhase, loadData]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    if (indexerPhase !== IndexerPhase.Ready) return;
    const interval = setInterval(() => loadData(true), 15000);
    return () => clearInterval(interval);
  }, [indexerPhase, loadData]);

  // Poll for changes after a transaction
  async function pollForChange(checkFn: () => Promise<boolean>, maxAttempts = 15) {
    setTxProgress("submitted");
    await new Promise((r) => setTimeout(r, 1000));
    setTxProgress("pending");
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const changed = await checkFn();
        if (changed) {
          setTxProgress("confirmed");
          setTimeout(() => setTxProgress(null), 3000);
          return true;
        }
      } catch {
        // keep polling
      }
    }
    setTxProgress("confirmed");
    setTimeout(() => setTxProgress(null), 3000);
    return false;
  }

  async function handlePledge(e: React.FormEvent) {
    e.preventDefault();
    setPledgeError(null);
    setPledgeTxHash(null);

    if (!signer) {
      setPledgeError("Please connect your wallet first");
      return;
    }

    if (!campaign) return;

    const amount = parseFloat(pledgeAmount);
    if (isNaN(amount) || amount <= 0) {
      setPledgeError("Please enter a valid pledge amount");
      return;
    }
    if (amount < MIN_PLEDGE_CKB) {
      setPledgeError(`The minimum pledge is ${MIN_PLEDGE_CKB} CKB`);
      return;
    }

    setPledging(true);

    try {
      const address = await signer.getRecommendedAddress();
      const client = signer.client;
      const addressObj = await ccc.Address.fromString(address, client);
      const backerLockScript = addressObj.script;
      const backerLockHash = backerLockScript.hash();

      const amountShannons = ckbToShannons(amount);

      // Pledges record the campaign's CREATION tx hash, which is what the indexer links
      // them by. campaign.txHash is the cell's current out point, and since v1.2 that moves
      // with every pledge — using it here would scatter pledges across identities.
      const linkageTxHash = (campaign.originalTxHash || campaign.txHash).replace(/^0x/, "");
      const backerHash = backerLockHash.startsWith("0x")
        ? backerLockHash.slice(2)
        : backerLockHash;

      // Build against the live campaign cell and submit. If another pledge spends that cell
      // first, wait for it to land and rebuild on top of it — the wallet asks again, since
      // the rebuilt transaction is a different one.
      let hash: string | undefined;
      for (let attempt = 1; !hash; attempt++) {
        const { cell: campaignCell, typeScriptHash } = await resolveLiveCampaignCell(
          client,
          campaign.campaignId
        );
        const campaignTypeHash = typeScriptHash.replace(/^0x/, "");

        // v1.2 accumulator: bump total_pledged and leave every other byte of the campaign
        // data alone — the type script requires a byte-identical metadata tail.
        const campaignData = ccc.hexFrom(campaignCell.outputData);
        const newCampaignData = withTotalPledged(
          campaignData,
          readTotalPledged(campaignData) + amountShannons
        );

        // Pledge cell data (72 bytes): campaign_id + backer_lock_hash + amount
        const pledgeData = "0x" + linkageTxHash + backerHash + u64ToHexLE(amountShannons);

        // Pledge lock args (72 bytes): campaign_type_script_hash + deadline_block + backer_lock_hash
        const deadlineBlock = BigInt(campaign.deadlineBlock);
        const pledgeLockArgs = "0x" + campaignTypeHash + u64ToHexLE(deadlineBlock) + backerHash;

        // Receipt cell data (80 bytes): pledge_amount + backer_lock_hash + campaign + deadline.
        // The campaign fields must match the pledge lock args; they let the backer reclaim
        // the receipt once the campaign is finalized.
        const receiptData =
          "0x" + u64ToHexLE(amountShannons) + backerHash + campaignTypeHash + u64ToHexLE(deadlineBlock);

        // Capacities, same formulas as the transaction builder
        const pledgeTotalCapacity = PLEDGE_CELL_OVERHEAD + amountShannons;
        const receiptCapacity = RECEIPT_CELL_CAPACITY;

        const tx = ccc.Transaction.from({
          inputs: [
            {
              // [0] Campaign cell — consumed and re-created with the updated total
              previousOutput: campaignCell.outPoint,
            },
          ],
          outputs: [
            {
              // [0] Campaign cell, capacity and scripts unchanged
              capacity: campaignCell.cellOutput.capacity,
              lock: campaignCell.cellOutput.lock,
              type: campaignCell.cellOutput.type,
            },
            {
              // [1] Pledge cell with custom pledge lock
              capacity: pledgeTotalCapacity,
              lock: {
                codeHash: CONTRACTS.pledgeLock.codeHash,
                hashType: CONTRACTS.pledgeLock.hashType,
                args: pledgeLockArgs,
              },
              type: {
                codeHash: CONTRACTS.pledge.codeHash,
                hashType: CONTRACTS.pledge.hashType,
                args: CONTRACTS.receipt.codeHash,
              },
            },
            {
              // [2] Receipt cell owned by backer
              capacity: receiptCapacity,
              lock: backerLockScript,
              type: {
                codeHash: CONTRACTS.receipt.codeHash,
                hashType: CONTRACTS.receipt.hashType,
                args: CONTRACTS.pledge.codeHash,
              },
            },
          ],
          outputsData: [newCampaignData, pledgeData, receiptData],
          cellDeps: [
            {
              outPoint: {
                txHash: CONTRACTS.pledge.txHash,
                index: CONTRACTS.pledge.index,
              },
              depType: "code",
            },
            {
              outPoint: {
                txHash: CONTRACTS.pledgeLock.txHash,
                index: CONTRACTS.pledgeLock.index,
              },
              depType: "code",
            },
            {
              outPoint: {
                txHash: CONTRACTS.receipt.txHash,
                index: CONTRACTS.receipt.index,
              },
              depType: "code",
            },
            {
              // Campaign type script — validates the accumulator update
              outPoint: {
                txHash: CONTRACTS.campaign.txHash,
                index: CONTRACTS.campaign.index,
              },
              depType: "code",
            },
            {
              // Campaign lock script — the campaign cell is an input now
              outPoint: {
                txHash: CONTRACTS.campaignLock.txHash,
                index: CONTRACTS.campaignLock.index,
              },
              depType: "code",
            },
          ],
        });

        // Empty witness for the campaign cell input (custom lock, no signature needed)
        tx.witnesses.push("0x");

        await tx.completeInputsByCapacity(signer);
        await tx.completeFeeBy(signer, 2000);

        try {
          hash = await signer.sendTransaction(tx);
        } catch (sendError) {
          if (attempt >= PLEDGE_ATTEMPTS || !isInputAlreadySpentError(sendError)) {
            if (isInputAlreadySpentError(sendError)) {
              throw new Error("Other pledges kept landing first. Please try again in a moment.");
            }
            throw sendError;
          }
          toast("info", "Another pledge landed at the same moment. Updating yours to go on top of it…");
          await waitForCampaignCellToMove(client, campaign.campaignId, campaignCell.outPoint);
          if (!isDevnet) toast("info", "Please approve the updated pledge in your wallet");
        }
      }

      setPledgeTxHash(hash);
      setPledgeAmount("");
      toast("success", "Pledge submitted successfully!");

      // Poll until the new pledge appears. The campaign cell moved when the pledge landed,
      // so refetch by its creation out point — the id in the URL may now be a dead cell.
      const stableId = campaign.originalTxHash ? `${campaign.originalTxHash}_0` : campaignId;
      const prevCount = pledges.length;
      await pollForChange(async () => {
        const newPledges = await fetchPledgesForCampaign(stableId);
        if (newPledges.length > prevCount) {
          setPledges(newPledges);
          const newCampaign = await fetchCampaign(stableId);
          if (newCampaign) setCampaign(newCampaign);
          return true;
        }
        return false;
      });
    } catch (err) {
      console.error("Failed to create pledge:", err);
      const msg = err instanceof Error ? err.message : "Failed to create pledge";
      if (msg.includes("rejected") || msg.includes("disconnected")) {
        toast("warning", "Transaction was cancelled");
      } else {
        setPledgeError(msg);
        toast("error", "Pledge failed");
      }
    } finally {
      setPledging(false);
    }
  }

  async function handleFinalize() {
    if (!signer || !campaign) return;
    setActionLoading(true);
    setActionTxHash(null);

    try {
      const client = signer.client;

      // v1.2: the outcome is decided by the on-chain accumulator, not by the indexer's
      // numbers, and the campaign type script rejects a status the total does not support.
      // Read the live cell and edit only its status byte — re-serializing the data would
      // risk a mismatch in the metadata tail, which the type script requires unchanged.
      const { cell: campaignCell } = await resolveLiveCampaignCell(client, campaign.campaignId);
      const campaignData = ccc.hexFrom(campaignCell.outputData);

      const totalPledged = readTotalPledged(campaignData);
      const fundingGoal = readFundingGoal(campaignData);
      const newStatus = totalPledged >= fundingGoal ? CampaignStatus.Success : CampaignStatus.Failed;
      const newCampaignData = withCampaignStatus(campaignData, newStatus);

      const deadlineBlock = BigInt(campaign.deadlineBlock);

      const tx = ccc.Transaction.from({
        inputs: [
          {
            previousOutput: campaignCell.outPoint,
            since: deadlineBlock,
          },
        ],
        outputs: [
          {
            // Capacity is preserved exactly — the type script rejects a campaign cell that
            // comes out of a transition worth less than it went in.
            capacity: campaignCell.cellOutput.capacity,
            lock: campaignCell.cellOutput.lock,
            type: campaignCell.cellOutput.type,
          },
        ],
        outputsData: [newCampaignData],
        cellDeps: [
          {
            outPoint: {
              txHash: CONTRACTS.campaign.txHash,
              index: CONTRACTS.campaign.index,
            },
            depType: "code",
          },
          {
            outPoint: {
              txHash: CONTRACTS.campaignLock.txHash,
              index: CONTRACTS.campaignLock.index,
            },
            depType: "code",
          },
        ],
      });

      tx.witnesses.push("0x");

      await tx.completeFeeBy(signer, 2000);
      const hash = await signer.sendTransaction(tx);
      setActionTxHash(hash);
      toast("success", "Campaign finalized! Redirecting...");

      // Poll until the finalized campaign appears
      const newCampaignId = hash + "_0";
      const maxAttempts = 20;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const found = await fetchCampaign(newCampaignId);
        if (found) {
          router.push(`/campaigns/${encodeURIComponent(newCampaignId)}`);
          return;
        }
      }
      router.push(`/campaigns/${encodeURIComponent(newCampaignId)}`);
    } catch (err) {
      console.error("Failed to finalize campaign:", err);
      const msg = err instanceof Error ? err.message : "Failed to finalize campaign";
      if (msg.includes("rejected") || msg.includes("disconnected")) {
        toast("warning", "Transaction was cancelled");
      } else {
        toast("error", msg);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTriggerRelease() {
    if (!signer || !campaign || pledges.length === 0) return;
    setActionLoading(true);
    setActionTxHash(null);

    try {
      const client = signer.client;

      // Get creator's lock script from campaign
      const creatorLockScript = campaign.creatorLockScript || {
        codeHash: "",
        hashType: "",
        args: "",
      };

      // Release the first live pledge. Work from pledges, not receipts: a backer may already
      // have reclaimed their receipt, and the pledge lock needs nothing from it.
      const pledgeCell = pledges[0];

      // Fetch actual pledge cell capacity from chain (includes base + pledge amount)
      const pledgeTxData = await client.getTransaction(pledgeCell.txHash);
      if (!pledgeTxData || !pledgeTxData.transaction) {
        toast("error", "Could not fetch pledge transaction from chain");
        return;
      }
      const pledgeOutput = pledgeTxData.transaction.outputs[pledgeCell.index]!;
      const pledgeCapacity = BigInt(pledgeOutput.capacity);
      const pledgeAmount = BigInt(pledgeCell.amount);

      // The creator receives exactly the pledged amount; the cell's storage overhead goes back
      // to the backer. The pledge cell only stores the backer's lock hash, so find the full
      // lock among the pledge transaction's outputs (the receipt is always one of them).
      const backerLockHash = ccc.hexFrom(ccc.bytesFrom(pledgeOutput.lock.args).slice(40, 72));
      const backerLock = pledgeTxData.transaction.outputs
        .map((o: { lock: ccc.Script }) => ccc.Script.from(o.lock))
        .find((lock: ccc.Script) => lock.hash() === backerLockHash);
      if (!backerLock) {
        toast("error", "Could not find the backer's lock script for this pledge");
        return;
      }
      const creatorLock = ccc.Script.from({
        codeHash: creatorLockScript.codeHash || "",
        hashType: (creatorLockScript.hashType || "type") as ccc.HashTypeLike,
        args: creatorLockScript.args || "",
      });
      const releaseFee = BigInt(100000);
      const releaseOutputs = creatorLock.eq(backerLock)
        ? [{ capacity: pledgeCapacity - releaseFee, lock: creatorLock }]
        : [
            { capacity: pledgeAmount, lock: creatorLock },
            { capacity: pledgeCapacity - pledgeAmount - releaseFee, lock: backerLock },
          ];

      // Get campaign cell outpoint for deps
      const [campaignTxHash, campaignIndexStr] = campaign.campaignId.split("_");
      const campaignCellDep = {
        txHash: campaignTxHash,
        index: parseInt(campaignIndexStr),
      };

      // Build permissionless release transaction
      const tx = ccc.Transaction.from({
        inputs: [
          {
            previousOutput: {
              txHash: pledgeCell.txHash,
              index: pledgeCell.index,
            },
            since: campaign.deadlineBlock,
          },
        ],
        outputs: releaseOutputs,
        outputsData: releaseOutputs.map(() => "0x"),
        cellDeps: [
          {
            outPoint: campaignCellDep,
            depType: "code",
          },
          {
            outPoint: {
              txHash: CONTRACTS.pledgeLock.txHash,
              index: CONTRACTS.pledgeLock.index,
            },
            depType: "code",
          },
          {
            outPoint: {
              txHash: CONTRACTS.pledge.txHash,
              index: CONTRACTS.pledge.index,
            },
            depType: "code",
          },
        ],
      });

      // The fee is already taken out of the pledge cell, so the triggering wallet adds no inputs
      const hash = await signer.sendTransaction(tx);
      setActionTxHash(hash);
      toast("success", "Release triggered! Funds being sent to creator...");

      // Poll for receipt distribution update
      await pollForChange(async () => {
        const updatedPledges = await fetchPledgesForCampaign(campaignId);
        setPledges(updatedPledges);
        return updatedPledges.length < pledges.length;
      });
    } catch (err) {
      console.error("Failed to trigger release:", err);
      const msg = err instanceof Error ? err.message : "Failed to trigger release";
      if (msg.includes("rejected") || msg.includes("disconnected")) {
        toast("warning", "Transaction was cancelled");
      } else {
        toast("error", msg);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTriggerRefund() {
    if (!signer || !campaign || pledges.length === 0) return;
    setActionLoading(true);
    setActionTxHash(null);

    try {
      const client = signer.client;

      // Refund the first live pledge to its backer. Anyone can trigger this: the pledge lock
      // routes the funds to the backer's lock hash in its args, whoever signs.
      const pledgeCell = pledges[0];
      const pledgeTxData = await client.getTransaction(pledgeCell.txHash);
      if (!pledgeTxData || !pledgeTxData.transaction) {
        toast("error", "Could not fetch pledge transaction from chain");
        return;
      }
      const pledgeOutput = pledgeTxData.transaction.outputs[pledgeCell.index]!;
      const pledgeCapacity = BigInt(pledgeOutput.capacity);

      // The pledge cell only stores the backer's lock hash; the full lock is among the
      // outputs of the transaction that created it (the receipt is always one of them)
      const backerLockHash = ccc.hexFrom(ccc.bytesFrom(pledgeOutput.lock.args).slice(40, 72));
      const backerLock = pledgeTxData.transaction.outputs
        .map((o: { lock: ccc.Script }) => ccc.Script.from(o.lock))
        .find((lock: ccc.Script) => lock.hash() === backerLockHash);
      if (!backerLock) {
        toast("error", "Could not find the backer's lock script for this pledge");
        return;
      }

      // The finalized campaign cell must be a cell dep: without it the pledge lock only
      // allows a refund after the grace period
      const { cell: campaignCell } = await resolveLiveCampaignCell(client, campaign.campaignId);

      const tx = ccc.Transaction.from({
        inputs: [
          {
            previousOutput: { txHash: pledgeCell.txHash, index: pledgeCell.index },
            since: campaign.deadlineBlock,
          },
        ],
        outputs: [{ capacity: pledgeCapacity - BigInt(100000), lock: backerLock }],
        outputsData: ["0x"],
        cellDeps: [
          { outPoint: campaignCell.outPoint, depType: "code" },
          {
            outPoint: { txHash: CONTRACTS.pledgeLock.txHash, index: CONTRACTS.pledgeLock.index },
            depType: "code",
          },
          {
            outPoint: { txHash: CONTRACTS.pledge.txHash, index: CONTRACTS.pledge.index },
            depType: "code",
          },
        ],
      });

      const hash = await signer.sendTransaction(tx);
      setActionTxHash(hash);
      toast("success", "Refund triggered! Funds being returned to the backer...");

      await pollForChange(async () => {
        const updatedPledges = await fetchPledgesForCampaign(campaignId);
        setPledges(updatedPledges);
        return updatedPledges.length < pledges.length;
      });
    } catch (err) {
      console.error("Failed to trigger refund:", err);
      const msg = err instanceof Error ? err.message : "Failed to trigger refund";
      if (msg.includes("rejected") || msg.includes("disconnected")) {
        toast("warning", "Transaction was cancelled");
      } else {
        toast("error", msg);
      }
    } finally {
      setActionLoading(false);
    }
  }

  /**
   * Reclaim the connected wallet's receipt deposits for this campaign.
   *
   * Every pledge leaves a receipt cell in the backer's wallet. Once the campaign is finalized
   * the receipt type script lets the backer destroy it, with the finalized campaign cell as a
   * cell dep, so all of the wallet's receipts go back into one plain cell in a single
   * transaction. The fee comes out of the reclaimed capacity.
   */
  async function handleReclaimReceipts(ownReceipts: Receipt[]) {
    if (!signer || !campaign || ownReceipts.length === 0) return;
    setReclaiming(true);

    try {
      const client = signer.client;

      const { cell: campaignCell } = await resolveLiveCampaignCell(client, campaign.campaignId);
      if (readCampaignStatus(ccc.hexFrom(campaignCell.outputData)) === CampaignStatus.Active) {
        toast("warning", "The campaign has to be finalized before deposits can be reclaimed");
        return;
      }

      const inputs: { previousOutput: { txHash: string; index: number } }[] = [];
      let total = BigInt(0);
      let lock: ccc.Script | undefined;
      let legacy = 0;
      for (const receipt of ownReceipts) {
        const receiptTx = await client.getTransaction(receipt.txHash);
        const output = receiptTx?.transaction?.outputs[receipt.index];
        const data = receiptTx?.transaction?.outputsData[receipt.index];
        if (!output || data === undefined) continue;
        // Receipts from before v1.2 carry no campaign fields and can't be reclaimed this way
        if (ccc.bytesFrom(data).length < 80) {
          legacy++;
          continue;
        }
        inputs.push({ previousOutput: { txHash: receipt.txHash, index: receipt.index } });
        total += BigInt(output.capacity);
        lock = ccc.Script.from(output.lock);
      }
      if (inputs.length === 0 || !lock) {
        toast("error", legacy > 0 ? "These receipts predate v1.2 and can't be reclaimed here" : "No receipts found to reclaim");
        return;
      }

      const tx = ccc.Transaction.from({
        inputs,
        outputs: [{ capacity: total, lock }],
        outputsData: ["0x"],
        cellDeps: [
          { outPoint: campaignCell.outPoint, depType: "code" },
          {
            outPoint: { txHash: CONTRACTS.receipt.txHash, index: CONTRACTS.receipt.index },
            depType: "code",
          },
        ],
      });
      await tx.completeFeeChangeToOutput(signer, 0, 1000);

      const hash = await signer.sendTransaction(tx);
      setActionTxHash(hash);
      toast("success", `Reclaiming ${formatCost(total)} CKB in deposits`);

      const reclaimed = new Set(inputs.map((i) => `${i.previousOutput.txHash}_${i.previousOutput.index}`.toLowerCase()));
      await pollForChange(async () => {
        const updated = await fetchReceiptsForCampaign(campaignId).catch(() => [] as Receipt[]);
        const stillThere = updated.some((r) => reclaimed.has(`${r.txHash}_${r.index}`.toLowerCase()));
        if (!stillThere) setReceipts(updated);
        return !stillThere;
      });
    } catch (err) {
      console.error("Failed to reclaim receipts:", err);
      const msg = err instanceof Error ? err.message : "Failed to reclaim deposits";
      if (msg.includes("rejected") || msg.includes("disconnected")) {
        toast("warning", "Transaction was cancelled");
      } else {
        toast("error", msg);
      }
    } finally {
      setReclaiming(false);
    }
  }

  async function handleDestroy() {
    if (!signer || !campaign) return;
    setActionLoading(true);
    setActionTxHash(null);

    try {
      const address = await signer.getRecommendedAddress();
      const client = signer.client;
      const lockScript = (await ccc.Address.fromString(address, client)).script;

      const { cell: campaignCell } = await resolveLiveCampaignCell(client, campaign.campaignId);

      // The campaign-lock needs since >= deadline and the campaign type script needs
      // since >= deadline + grace period, so one since satisfies both. The whole capacity
      // goes back to the creator, less the fee, which the type script allows up to 1 CKB.
      const tx = ccc.Transaction.from({
        inputs: [
          {
            previousOutput: campaignCell.outPoint,
            since: BigInt(campaign.deadlineBlock) + GRACE_PERIOD_BLOCKS,
          },
        ],
        outputs: [
          {
            capacity: campaignCell.cellOutput.capacity,
            lock: lockScript,
            // No type script — plain CKB cell, capacity reclaimed
          },
        ],
        outputsData: ["0x"],
        cellDeps: [
          {
            outPoint: {
              txHash: CONTRACTS.campaign.txHash,
              index: CONTRACTS.campaign.index,
            },
            depType: "code",
          },
          {
            outPoint: {
              txHash: CONTRACTS.campaignLock.txHash,
              index: CONTRACTS.campaignLock.index,
            },
            depType: "code",
          },
        ],
      });

      tx.witnesses.push("0x");

      await tx.completeFeeChangeToOutput(signer, 0, 1000);
      const hash = await signer.sendTransaction(tx);
      setActionTxHash(hash);
      toast("success", "Campaign destroyed! Redirecting...");

      // Poll until campaign disappears from indexer, then redirect
      await pollForChange(async () => {
        const found = await fetchCampaign(campaignId);
        if (!found) return true;
        return false;
      });
      router.push("/app");
    } catch (err) {
      console.error("Failed to destroy campaign:", err);
      const msg = err instanceof Error ? err.message : "Failed to destroy campaign";
      if (msg.includes("rejected") || msg.includes("disconnected")) {
        toast("warning", "Transaction was cancelled");
      } else {
        toast("error", msg);
      }
    } finally {
      setActionLoading(false);
    }
  }

  function copyCampaignId() {
    navigator.clipboard.writeText(campaign?.campaignId || "");
    setIdCopied(true);
    setTimeout(() => setIdCopied(false), 2000);
  }

  // Sort pledges
  const sortedPledges = [...pledges].sort((a, b) => {
    if (pledgeSortMode === "amount") {
      return Number(BigInt(b.amount) - BigInt(a.amount));
    }
    // recent: by createdAt block descending
    return Number(BigInt(b.createdAt) - BigInt(a.createdAt));
  });

  if (indexerPhase !== IndexerPhase.Ready) {
    return (
      <div className="max-w-4xl mx-auto">
        <IndexerWaitNotice phase={indexerPhase} elapsedSeconds={elapsedSeconds} onRetry={retryIndexer} />
        {indexerPhase !== IndexerPhase.Offline && <SkeletonDetailPage />}
      </div>
    );
  }

  if (loading) {
    return <SkeletonDetailPage />;
  }

  if (error || !campaign) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200">
            {error || "Campaign not found"}
          </p>
        </div>
        <Link
          href="/app"
          className="inline-block mt-4 text-blue-600 hover:underline"
        >
          Back to campaigns
        </Link>
      </div>
    );
  }

  const progress = getFundingProgress(campaign.totalPledged, campaign.fundingGoal);
  const isExpired = currentBlock !== null && BigInt(campaign.deadlineBlock) < currentBlock;
  const canPledge = campaign.status === CampaignStatus.Active && !isExpired;
  const isCreator = walletLockHash !== null && campaign.creator.toLowerCase() === walletLockHash.toLowerCase();
  const needsFinalization = campaign.status === CampaignStatus.Active && isExpired;
  const canFinalize = needsFinalization && campaign.status === CampaignStatus.Active;
  const effectiveStatus = campaign.effectiveStatus || (
    campaign.status === CampaignStatus.Active
      ? (isExpired
        ? (BigInt(campaign.totalPledged) >= BigInt(campaign.fundingGoal) ? "expired_success" : "expired_failed")
        : "active")
      : campaign.status === CampaignStatus.Success ? "success" : "failed"
  );
  const blocksRemaining = currentBlock !== null
    ? BigInt(campaign.deadlineBlock) - currentBlock
    : null;
  const backerCount = campaign?.backerCount ?? 0;

  /** Receipts in the connected wallet, and whether their deposits can be reclaimed yet */
  const ownReceipts = walletLockHash
    ? receipts.filter((r) => r.backer.toLowerCase() === walletLockHash.toLowerCase())
    : [];
  const ownDeposit = RECEIPT_CELL_CAPACITY * BigInt(ownReceipts.length);
  const canReclaim = ownReceipts.length > 0 && campaign.status !== CampaignStatus.Active;

  /**
   * The campaign type script only lets a finalized campaign cell be destroyed once the grace
   * period past the deadline is over, so backers can still settle against it until then.
   */
  const graceEndBlock = BigInt(campaign.deadlineBlock) + GRACE_PERIOD_BLOCKS;
  const creatorCanDestroyLater = isCreator && campaign.status !== CampaignStatus.Active && pledges.length === 0;
  const canDestroy = creatorCanDestroyLater && currentBlock !== null && currentBlock >= graceEndBlock;

  /** Derive distribution counts from receipts and live pledges */
  const receiptCount = receipts.length;
  const livePledgeCount = pledges.length;
  const distributedCount = Math.max(0, receiptCount - livePledgeCount);
  const releasedCount = (campaign?.status === CampaignStatus.Success) ? distributedCount : 0;
  const refundedCount = (campaign?.status === CampaignStatus.Failed) ? distributedCount : 0;
  // Receipts disappear when backers reclaim them, so a campaign that raised funds but has
  // neither receipts nor live pledges left has distributed everything
  const distributionSummary =
    receiptCount === 0 && livePledgeCount === 0 && BigInt(campaign.totalPledged) > BigInt(0)
      ? campaign.status === CampaignStatus.Success
        ? "All pledges released to creator"
        : "All pledges refunded to backers"
      : getDistributionSummary(receiptCount, releasedCount, refundedCount, effectiveStatus);

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/app"
        className="inline-block mb-6 text-ink-2 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        &larr; Back to campaigns
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Pledge Form Sidebar — appears first on mobile */}
        <div className="lg:col-span-1 order-first lg:order-last">
          <div className="border border-line rounded-lg p-6 sticky top-8">
            <h2 className="text-lg font-semibold mb-4">Make a Pledge</h2>

            {!canPledge ? (
              <div className="space-y-4">
                <div className="bg-surface-3 rounded-lg p-4 text-center">
                  <p className="text-ink-2">
                    {isExpired
                      ? "This campaign has expired"
                      : "This campaign is no longer accepting pledges"}
                  </p>
                </div>

                {ownReceipts.length > 0 && (
                  <div className="rounded-lg border border-line p-4">
                    <h3 className="font-medium mb-1">Your receipt deposit</h3>
                    <p className="text-sm text-ink-2 mb-3">
                      {ownReceipts.length === 1
                        ? `Your pledge left a ${formatCost(ownDeposit)} CKB receipt deposit in your wallet.`
                        : `Your ${ownReceipts.length} pledges left ${formatCost(ownDeposit)} CKB in receipt deposits in your wallet.`}{" "}
                      {canReclaim
                        ? "The campaign is finalized, so you can take it back."
                        : "You can take it back once the campaign is finalized."}
                    </p>
                    {canReclaim && (
                      <button
                        onClick={() => handleReclaimReceipts(ownReceipts)}
                        disabled={reclaiming}
                        className="w-full px-4 py-2 font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
                      >
                        {reclaiming ? "Reclaiming..." : `Reclaim ${formatCost(ownDeposit)} CKB`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : !signer ? (
              <div className="text-center">
                <p className="text-ink-2 mb-4">
                  Connect your wallet to make a pledge
                </p>
                <button
                  onClick={open}
                  className="w-full px-4 py-2 font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 min-h-[44px]"
                >
                  Connect Wallet
                </button>
              </div>
            ) : (
              <form onSubmit={handlePledge} className="space-y-4">
                <div>
                  <label
                    htmlFor="pledgeAmount"
                    className="block text-sm font-medium mb-2"
                  >
                    Amount (CKB)
                  </label>
                  <input
                    type="number"
                    id="pledgeAmount"
                    value={pledgeAmount}
                    onChange={(e) => {
                      const value = e.target.value;
                      setPledgeAmount(value);
                      // Clear error if input is valid (non-empty, positive number)
                      if (value && !isNaN(parseFloat(value)) && parseFloat(value) >= MIN_PLEDGE_CKB) {
                        setPledgeError(null);
                      }
                    }}
                    placeholder={String(MIN_PLEDGE_CKB)}
                    min={MIN_PLEDGE_CKB}
                    step="1"
                    className="w-full px-4 py-2 border border-line rounded-lg bg-surface-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={pledging}
                  />
                  <p className="mt-1 text-xs text-ink-3">Minimum {MIN_PLEDGE_CKB} CKB</p>
                </div>

                {pledgeAmount && (
                  <div className="mt-3 p-3 bg-surface-2 rounded-lg border border-line">
                    <div className="text-xs font-semibold text-ink-2 mb-2">Cost Breakdown</div>
                    {(() => {
                      const breakdown = calculateCostBreakdown(pledgeAmount);
                      return (
                        <div className="space-y-1 text-xs text-ink-2">
                          <div className="flex justify-between gap-2">
                            <span>Pledge</span>
                            <span className="font-medium whitespace-nowrap">{formatCost(breakdown.pledgeAmount)} CKB</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>Pledge deposit (refunded)</span>
                            <span className="font-medium whitespace-nowrap">{formatCost(breakdown.pledgeDeposit)} CKB</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>Receipt deposit (refunded)</span>
                            <span className="font-medium whitespace-nowrap">{formatCost(breakdown.receiptDeposit)} CKB</span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>Network fee</span>
                            <span className="font-medium whitespace-nowrap">&lt; 0.01 CKB</span>
                          </div>
                          <div className="border-t border-line my-2 pt-2 flex justify-between font-semibold text-ink">
                            <span>Leaves your wallet</span>
                            <span className="whitespace-nowrap">{formatCost(breakdown.totalFromWallet)} CKB</span>
                          </div>
                          <p className="pt-1 leading-snug">
                            The deposits pay for on-chain storage and come back to you. The pledge
                            deposit returns when the pledge is paid out or refunded; the receipt
                            deposit when you reclaim it after the campaign ends.
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {pledgeError && (
                  <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-3">
                    <p className="text-sm text-red-800 dark:text-red-200">
                      {pledgeError}
                    </p>
                  </div>
                )}

                {pledgeTxHash && (
                  <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-3">
                    <p className="text-sm text-green-800 dark:text-green-200 font-medium">
                      Pledge submitted!
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-300 font-mono mt-1 break-all">
                      TX: {formatHash(pledgeTxHash, 12)}
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={pledging}
                  className="w-full px-4 py-3 font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                >
                  {pledging ? "Submitting..." : "Pledge"}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Campaign Details */}
        <div className="lg:col-span-2 space-y-6">
          <div className="border border-line rounded-lg p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 min-w-0">
                {campaign.title ? (
                  <h2 className="text-2xl font-bold">{campaign.title}</h2>
                ) : (
                  <>
                    <p className="text-sm text-ink-3 mb-1">Campaign ID</p>
                    <p className="font-mono text-sm break-all">{campaign.campaignId}</p>
                  </>
                )}
              </div>
              <span
                className={`px-3 py-1 text-sm font-medium rounded whitespace-nowrap ml-2 ${getEffectiveStatusColor(effectiveStatus)}`}
              >
                {getEffectiveStatusLabel(effectiveStatus)}
              </span>
            </div>

            {/* Collapsible Campaign ID */}
            {campaign.title && (
              <div className="mb-4">
                <button
                  onClick={() => setShowCampaignId(!showCampaignId)}
                  className="text-xs text-ink-3 hover:text-zinc-700 dark:hover:text-zinc-300 flex items-center gap-1"
                >
                  <span>{showCampaignId ? "Hide" : "Show"} Campaign ID</span>
                  <span>{showCampaignId ? "\u25B2" : "\u25BC"}</span>
                </button>
                {showCampaignId && (
                  <div className="mt-1 flex items-center gap-2">
                    <p className="font-mono text-xs text-ink-3 break-all flex-1">
                      {campaign.campaignId}
                    </p>
                    <button
                      onClick={copyCampaignId}
                      className="text-xs px-2 py-1 rounded border border-line hover:bg-surface-3 whitespace-nowrap"
                    >
                      {idCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {campaign.description && (
              <p className="text-ink-2 mb-4">
                {campaign.description}
              </p>
            )}

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-ink-2">
                    Funding Progress
                  </span>
                  <span className="font-medium">{progress.toFixed(1)}%</span>
                </div>
                <div className="h-3 bg-line-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all"
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-surface-2 rounded-lg">
                  <p className="text-sm text-ink-3 mb-1">Pledged</p>
                  <p className="text-2xl font-bold">
                    {shannonsToCKB(campaign.totalPledged)} CKB
                  </p>
                </div>
                <div className="p-4 bg-surface-2 rounded-lg">
                  <p className="text-sm text-ink-3 mb-1">Goal</p>
                  <p className="text-2xl font-bold">
                    {shannonsToCKB(campaign.fundingGoal)} CKB
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-ink-3">Deadline Block</p>
                  <p className="font-medium">
                    #{campaign.deadlineBlock}
                    {blocksRemaining !== null && (
                      <span className="text-ink-3 ml-1 text-xs">
                        ({blocksRemaining > 0n
                          ? blocksToTimeEstimate(blocksRemaining) + " left"
                          : "Expired"})
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-ink-3">Current Block</p>
                  <p className="font-medium">
                    #{currentBlock?.toString() || "..."}
                    {isExpired && (
                      <span className="ml-2 text-red-600">(Expired)</span>
                    )}
                  </p>
                </div>
              </div>

              {campaign.createdAt && currentBlock !== null && (
                <div className="text-sm">
                  <p className="text-ink-3">Created at block</p>
                  <p className="font-medium">
                    #{campaign.createdAt}
                    <span className="text-ink-3 ml-1 text-xs">
                      ({blockToRelativeTime(campaign.createdAt, currentBlock)})
                    </span>
                  </p>
                </div>
              )}

              <div className="pt-4 border-t border-line">
                <p className="text-sm text-ink-3 mb-1">Creator</p>
                {names.get(campaign.creator.toLowerCase()) && (
                  <p className="font-medium">{names.get(campaign.creator.toLowerCase())}</p>
                )}
                <p className="font-mono text-sm break-all">{campaign.creator}</p>
              </div>

              <div>
                <p className="text-sm text-ink-3 mb-1">Transaction</p>
                <p className="font-mono text-sm break-all">{campaign.txHash}</p>
              </div>
            </div>
          </div>

          {/* Transaction Progress Indicator */}
          {txProgress && (
            <div className="border border-line rounded-lg p-4">
              <div className="flex items-center gap-3">
                {["submitted", "pending", "confirmed"].map((step, i) => (
                  <div key={step} className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        (step === "submitted" && txProgress) ||
                        (step === "pending" && (txProgress === "pending" || txProgress === "confirmed")) ||
                        (step === "confirmed" && txProgress === "confirmed")
                          ? "bg-blue-600"
                          : "bg-zinc-300 dark:bg-zinc-700"
                      }`}
                    />
                    <span className="text-xs text-ink-2 capitalize">
                      {step}
                    </span>
                    {i < 2 && (
                      <div className="w-8 h-px bg-zinc-300 dark:bg-zinc-700" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Distribution Status */}
          {campaign.status !== CampaignStatus.Active && (
            <div className="border border-line rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-2">Distribution Status</h2>
              <p className="text-sm text-ink-2">
                {distributionSummary}
              </p>
              <p className="text-xs text-ink-3 mt-1">
                The finalization bot releases or refunds every pledge automatically. Anyone can also trigger it.
              </p>

              {signer && pledges.length > 0 && (
                <div className="mt-4 space-y-2">
                  {campaign.status === CampaignStatus.Success && (
                    <button
                      onClick={handleTriggerRelease}
                      disabled={actionLoading}
                      className="w-full px-4 py-3 font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                    >
                      {actionLoading ? "Triggering Release..." : "Trigger Release"}
                    </button>
                  )}

                  {campaign.status === CampaignStatus.Failed && (
                    <button
                      onClick={handleTriggerRefund}
                      disabled={actionLoading}
                      className="w-full px-4 py-3 font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                    >
                      {actionLoading ? "Triggering Refund..." : "Trigger Refund"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Actions Section */}
          {signer && (canFinalize || (isCreator && campaign.status !== CampaignStatus.Active && pledges.length === 0)) && (
            <div className="border border-line rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Actions</h2>

              {actionTxHash && (
                <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-3 mb-4">
                  <p className="text-sm text-green-800 dark:text-green-200 font-medium">
                    Transaction submitted!
                  </p>
                  <p className="text-xs text-green-700 dark:text-green-300 font-mono mt-1 break-all">
                    TX: {formatHash(actionTxHash, 12)}
                  </p>
                </div>
              )}

              {canFinalize && (
                <div className="mb-4">
                  <p className="text-sm text-ink-2 mb-2">
                    This campaign has expired and needs to be finalized on-chain.
                    {BigInt(campaign.totalPledged) >= BigInt(campaign.fundingGoal)
                      ? " The funding goal was met, so it will be marked Funded and the pledges released to the creator."
                      : " The funding goal was not met, so it will be marked Unsuccessful and every pledge refunded to its backer."}
                  </p>
                  <button
                    onClick={handleFinalize}
                    disabled={actionLoading}
                    className="w-full px-4 py-3 font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                  >
                    {actionLoading ? "Finalizing..." : "Finalize Campaign"}
                  </button>
                </div>
              )}

              {creatorCanDestroyLater && !canDestroy && currentBlock !== null && (
                <p className="mt-4 text-sm text-ink-2">
                  All pledges have been handled. You can destroy this campaign cell and reclaim its CKB
                  after block #{graceEndBlock.toLocaleString()} (around{" "}
                  {blockNumberToDate(graceEndBlock, currentBlock).toLocaleDateString(undefined, { dateStyle: "medium" })}).
                  The wait gives every backer time to settle against it and reclaim their receipt.
                </p>
              )}

              {canDestroy && (
                <div className="mt-4">
                  <p className="text-sm text-ink-2 mb-2">
                    All pledges have been handled. You can destroy this campaign cell to reclaim its CKB capacity.
                  </p>
                  <button
                    onClick={handleDestroy}
                    disabled={actionLoading}
                    className="w-full px-4 py-3 font-medium rounded-lg bg-zinc-600 text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                  >
                    {actionLoading ? "Destroying..." : "Destroy Campaign & Reclaim CKB"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Pledges List */}
          <div className="border border-line rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {campaign.status === CampaignStatus.Active ? "Pledges" : "Unsettled pledges"} ({pledges.length}){" "}
                {backerCount > 0 && (
                  <span className="text-sm font-normal text-ink-3">
                    from {backerCount} backer{backerCount !== 1 ? "s" : ""}
                  </span>
                )}
              </h2>
              {pledges.length > 1 && (
                <div className="flex items-center gap-1 text-xs">
                  <button
                    onClick={() => setPledgeSortMode("recent")}
                    className={`px-2 py-1 rounded ${
                      pledgeSortMode === "recent"
                        ? "bg-line font-medium"
                        : "text-ink-3 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}
                  >
                    Recent
                  </button>
                  <button
                    onClick={() => setPledgeSortMode("amount")}
                    className={`px-2 py-1 rounded ${
                      pledgeSortMode === "amount"
                        ? "bg-line font-medium"
                        : "text-ink-3 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}
                  >
                    Amount
                  </button>
                </div>
              )}
            </div>

            {pledges.length === 0 ? (
              <p className="text-ink-3 text-center py-4">
                {canPledge
                  ? "No pledges yet. Be the first to support this campaign."
                  : BigInt(campaign.totalPledged) > BigInt(0)
                    ? "Every pledge has been settled."
                    : "This campaign received no pledges."}
              </p>
            ) : (
              <div className="space-y-3">
                {sortedPledges.map((pledge) => {
                  const receipt = receipts.find(
                    (r) => r.txHash.toLowerCase() === pledge.txHash.toLowerCase()
                  );
                  return (
                    <div
                      key={pledge.pledgeId}
                      className="flex items-center justify-between p-3 bg-surface-2 rounded-lg"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-sm truncate">
                            <LockName lockHash={pledge.backer} names={names} />
                          </p>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded ${getPledgeDistributionColor("locked")}`}>
                            {getPledgeDistributionLabel("locked")}
                          </span>
                        </div>
                        <p className="text-xs text-ink-3">
                          Block #{pledge.createdAt}
                          {currentBlock !== null && (
                            <span className="ml-1">
                              ({blockToRelativeTime(pledge.createdAt, currentBlock)})
                            </span>
                          )}
                        </p>
                        {receipt && (
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-ink-3">
                              Receipt: {shannonsToCKB(receipt.pledgeAmount)} CKB
                            </span>
                            {EXPLORER_URL && (
                              <a
                                href={getExplorerTxUrl(EXPLORER_URL, receipt.txHash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline"
                              >
                                View on Explorer
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="font-medium whitespace-nowrap ml-2">
                        {shannonsToCKB(pledge.amount)} CKB
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
