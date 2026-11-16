"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ccc } from "@ckb-ccc/connector-react";
import { Campaign, Pledge, CampaignStatus, Receipt, IndexerPhase } from "@/lib/types";
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
import { categoryLabel } from "@/lib/categories";
import { CONTRACTS, MIN_PLEDGE_CKB, PLEDGE_CELL_OVERHEAD, RECEIPT_CELL_CAPACITY, EXPLORER_URL, GRACE_PERIOD_BLOCKS } from "@/lib/constants";
import {
  u64ToHexLE,
  readTotalPledged,
  withTotalPledged,
  receiptTypeArgs,
} from "@/lib/serialization";
import { isInputAlreadySpentError, isWalletCancel, resolveLiveCampaignCell, sendFinalize, sendRelease, sendRefund, sendDestroy, sendReclaimReceipts } from "@/lib/campaignActions";
import { useDevnet } from "@/components/DevnetContext";
import { useWalletLockHash } from "@/components/useWallet";
import { useToast } from "@/components/Toast";
import { SkeletonDetailPage } from "@/components/Skeleton";
import { useIndexerReady, IndexerWaitNotice } from "@/components/IndexerStatus";
import { useCellNames } from "@/components/CellName";
import { VellumIdentityLink } from "@/components/VellumIdentityLink";

type PledgeSortMode = "recent" | "amount";

/** Pledge attempts before giving up when other pledges keep winning the campaign cell */
const PLEDGE_ATTEMPTS = 3;

/** How long to wait for the winning pledge to commit before rebuilding anyway */
const CAMPAIGN_CELL_MOVE_TIMEOUT_MS = 30000;

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
  const [reclaiming, setReclaiming] = useState(false);

  // UI state
  const [showCampaignId, setShowCampaignId] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
  const [pledgeSortMode, setPledgeSortMode] = useState<PledgeSortMode>("recent");
  const [txProgress, setTxProgress] = useState<"submitted" | "pending" | "confirmed" | null>(null);

  const walletLockHash = useWalletLockHash(signer);

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
                // Pledge code hash + pledge-lock code hash, so the receipt can recognise its pledge
                args: receiptTypeArgs(CONTRACTS.pledge.codeHash, CONTRACTS.pledgeLock.codeHash),
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
      if (isWalletCancel(err)) {
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
      const hash = await sendFinalize(signer, campaign);
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
      if (isWalletCancel(err)) {
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
      // Release the first live pledge. Work from pledges, not receipts: a backer may already
      // have reclaimed their receipt, and the pledge lock needs nothing from it.
      const hash = await sendRelease(signer, campaign, pledges[0]);
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
      if (isWalletCancel(err)) {
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
      const hash = await sendRefund(signer, campaign, pledges[0]);
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
      if (isWalletCancel(err)) {
        toast("warning", "Transaction was cancelled");
      } else {
        toast("error", msg);
      }
    } finally {
      setActionLoading(false);
    }
  }

  /** Reclaim the connected wallet's receipt deposits for this campaign (see sendReclaimReceipts) */
  async function handleReclaimReceipts(ownReceipts: Receipt[]) {
    if (!signer || !campaign || ownReceipts.length === 0) return;
    setReclaiming(true);

    try {
      const { hash, total, reclaimed } = await sendReclaimReceipts(signer, campaign, ownReceipts);
      setActionTxHash(hash);
      toast("success", `Reclaiming ${formatCost(total)} CKB in deposits`);

      await pollForChange(async () => {
        const updated = await fetchReceiptsForCampaign(campaignId).catch(() => [] as Receipt[]);
        const stillThere = updated.some((r) => reclaimed.has(`${r.txHash}_${r.index}`.toLowerCase()));
        if (!stillThere) setReceipts(updated);
        return !stillThere;
      });
    } catch (err) {
      console.error("Failed to reclaim receipts:", err);
      const msg = err instanceof Error ? err.message : "Failed to reclaim deposits";
      if (isWalletCancel(err)) {
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
      const hash = await sendDestroy(signer, campaign);
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
      if (isWalletCancel(err)) {
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
                {categoryLabel(campaign.category) && (
                  <p className="font-mono text-[11px] tracking-wider uppercase text-ink-3 mt-1.5">
                    {categoryLabel(campaign.category)}
                  </p>
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
                  <p className="font-medium break-all">{names.get(campaign.creator.toLowerCase())}</p>
                )}
                <p className="font-mono text-sm break-all">{campaign.creator}</p>
              </div>

              {campaign.creatorDid && (
                <div>
                  <p className="text-sm text-ink-3 mb-1">Vellum identity</p>
                  <VellumIdentityLink did={campaign.creatorDid} />
                </div>
              )}

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
                        {names.get(pledge.backer.toLowerCase()) && (
                          <p className="text-sm font-medium break-all">{names.get(pledge.backer.toLowerCase())}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-sm truncate" title={pledge.backer}>
                            {formatHash(pledge.backer)}
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
