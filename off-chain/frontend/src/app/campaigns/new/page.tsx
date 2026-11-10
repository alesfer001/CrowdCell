"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ccc } from "@ckb-ccc/connector-react";
import { ckbToShannons, datetimeToBlockNumber, toDatetimeLocal } from "@/lib/utils";
import { CONTRACTS, CAMPAIGN_DATA_SIZE, MIN_DEADLINE_HOURS } from "@/lib/constants";
import { u64ToHexLE, serializeMetadataHex, campaignTypeArgs } from "@/lib/serialization";
import { useDevnet } from "@/components/DevnetContext";
import { useToast } from "@/components/Toast";
import { fetchBlockNumber, fetchCampaign } from "@/lib/api";
import { IndexerPhase } from "@/lib/types";
import { CAMPAIGN_CATEGORIES } from "@/lib/categories";
import { useIndexerReady, IndexerWaitNotice } from "@/components/IndexerStatus";

/** The browser's time zone; null during the server render, which cannot know it */
function useTimeZone(): string | null {
  return useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => null
  );
}

const MIN_DEADLINE_LABEL = `${MIN_DEADLINE_HOURS} hour${MIN_DEADLINE_HOURS !== 1 ? "s" : ""}`;

export default function CreateCampaignPage() {
  const router = useRouter();
  const { open } = ccc.useCcc();
  const walletSigner = ccc.useSigner();
  const { isDevnet, devnetSigner } = useDevnet();
  const { toast } = useToast();

  const signer = isDevnet ? devnetSigner : walletSigner;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [fundingGoal, setFundingGoal] = useState("");
  const [deadlineDateTime, setDeadlineDateTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentBlock, setCurrentBlock] = useState<bigint | null>(null);
  const timeZone = useTimeZone();
  // Set when the picker gains focus, so it is never stale and never differs between server and client
  const [minDeadline, setMinDeadline] = useState<string | undefined>(undefined);

  // Field-level validation errors
  const [titleError, setTitleError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [deadlineError, setDeadlineError] = useState<string | null>(null);

  const { phase: indexerPhase, elapsedSeconds, retry: retryIndexer } = useIndexerReady();
  const indexerUp = indexerPhase === IndexerPhase.Ready || indexerPhase === IndexerPhase.Syncing;

  // Fetch current block once the indexer answers (the tip comes from the node, so a sync in progress is fine)
  useEffect(() => {
    if (!indexerUp) return;
    fetchBlockNumber()
      .then(setCurrentBlock)
      .catch(() => {});
  }, [indexerUp]);

  function validateCategory(): boolean {
    if (!CAMPAIGN_CATEGORIES.some((c) => c.slug === category)) {
      setCategoryError("Choose a category");
      return false;
    }
    setCategoryError(null);
    return true;
  }

  function validateTitle(): boolean {
    if (!title.trim()) {
      setTitleError("Title is required");
      return false;
    }
    setTitleError(null);
    return true;
  }

  function validateGoal(): boolean {
    const goal = parseFloat(fundingGoal);
    if (isNaN(goal) || goal <= 0) {
      setGoalError("Please enter a valid funding goal");
      return false;
    }
    if (goal < 100) {
      setGoalError("Funding goal must be at least 100 CKB");
      return false;
    }
    setGoalError(null);
    return true;
  }

  function validateDeadline(): boolean {
    if (!deadlineDateTime.trim()) {
      setDeadlineError("Please select a deadline date and time");
      return false;
    }
    if (currentBlock === null) {
      setDeadlineError("Unable to read the current block. Please refresh.");
      return false;
    }

    // datetime-local values carry no offset, so this parses them as the user's local time
    const targetDate = new Date(deadlineDateTime);
    if (isNaN(targetDate.getTime())) {
      setDeadlineError("Invalid date/time format");
      return false;
    }

    const minDateTime = new Date(Date.now() + MIN_DEADLINE_HOURS * 3600 * 1000);
    if (targetDate < minDateTime) {
      setDeadlineError(`Deadline must be at least ${MIN_DEADLINE_LABEL} from now`);
      return false;
    }

    setDeadlineError(null);
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!signer) {
      toast("warning", "Please connect your wallet first");
      return;
    }

    // Validate all fields
    const titleValid = validateTitle();
    const categoryValid = validateCategory();
    const goalValid = validateGoal();
    const deadlineValid = validateDeadline();
    if (!titleValid || !categoryValid || !goalValid || !deadlineValid) return;

    const goal = parseFloat(fundingGoal);
    const deadline = datetimeToBlockNumber(deadlineDateTime, currentBlock!);

    setLoading(true);

    try {
      const address = await signer.getRecommendedAddress();
      const client = signer.client;
      const addressObj = await ccc.Address.fromString(address, client);
      const creatorLockHash = addressObj.script.hash();

      const fundingGoalShannons = ckbToShannons(goal);
      const deadlineBlock = BigInt(deadline);

      const creatorHash = creatorLockHash.startsWith("0x")
        ? creatorLockHash.slice(2)
        : creatorLockHash;

      let campaignHex =
        creatorHash +
        u64ToHexLE(fundingGoalShannons) +
        u64ToHexLE(deadlineBlock) +
        u64ToHexLE(BigInt(0)) +
        "00" +
        "00".repeat(8);

      // Title is required, so the metadata is always there; the category byte follows the description
      const categoryCode = CAMPAIGN_CATEGORIES.find((c) => c.slug === category)!.code;
      campaignHex += serializeMetadataHex(title.trim(), description.trim(), categoryCode);

      const campaignData = "0x" + campaignHex;

      const dataSize = campaignHex.length / 2;
      // v1.2: campaign type args are 64 bytes (TypeID + pledge-lock code hash), so the type
      // script occupies 33 + 64 = 97 bytes rather than 65.
      const capacity = BigInt(Math.ceil((8 + dataSize + 97 + 65) * 1.2)) * BigInt(100000000);

      // Use campaign-lock script with deadline block as args (8 bytes LE)
      const campaignLockArgs = "0x" + u64ToHexLE(deadlineBlock);

      const tx = ccc.Transaction.from({
        outputs: [
          {
            capacity,
            lock: {
              codeHash: CONTRACTS.campaignLock.codeHash,
              hashType: CONTRACTS.campaignLock.hashType,
              args: campaignLockArgs,
            },
            type: {
              codeHash: CONTRACTS.campaign.codeHash,
              hashType: CONTRACTS.campaign.hashType,
              // Placeholder — replaced below once the TypeID can be computed from the inputs
              args: "0x" + "00".repeat(64),
            },
          },
        ],
        outputsData: [campaignData],
        cellDeps: [
          ...(CONTRACTS.campaign.txHash
            ? [
                {
                  outPoint: {
                    txHash: CONTRACTS.campaign.txHash,
                    index: CONTRACTS.campaign.index,
                  },
                  depType: "code" as const,
                },
              ]
            : []),
        ],
      });

      await tx.completeInputsByCapacity(signer);
      await tx.completeFeeBy(signer, 1000);

      console.log("Inputs:", tx.inputs.length, "Outputs:", tx.outputs.length);
      console.log("First input outpoint:", tx.inputs[0].previousOutput.txHash, tx.inputs[0].previousOutput.index);

      // Compute TypeID args: blake2b(molecule_serialized_first_input || output_index_u64_le)
      const firstInput = ccc.CellInput.from(tx.inputs[0]);
      const hasher = new ccc.HasherCkb();
      hasher.update(firstInput.toBytes());
      hasher.update(ccc.numLeToBytes(0, 8));
      // v1.2: the pledge-lock code hash rides along in args so the campaign type script can
      // recognise the pledge cells it accumulates.
      const typeArgs = campaignTypeArgs(hasher.digest(), CONTRACTS.pledgeLock.codeHash);
      tx.outputs[0].type!.args = ccc.hexFrom(typeArgs);
      console.log("Campaign type args:", typeArgs);

      console.log("Sending transaction...");
      const hash = await signer.sendTransaction(tx);
      console.log("TX hash:", hash);
      toast("success", "Campaign created!");

      // Poll indexer until the new campaign appears, then redirect
      const newCampaignId = hash + "_0";
      const maxAttempts = 20;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const found = await fetchCampaign(newCampaignId);
          if (found) {
            router.push(`/campaigns/${encodeURIComponent(newCampaignId)}`);
            return;
          }
        } catch {
          // keep polling
        }
      }
      // Timeout — redirect to home
      router.push("/app");
    } catch (err) {
      console.error("Failed to create campaign:", err);
      const msg = err instanceof Error ? err.message : "Failed to create campaign";
      if (msg.includes("rejected") || msg.includes("disconnected")) {
        toast("warning", "Transaction was cancelled");
      } else {
        toast("error", msg);
      }
    } finally {
      setLoading(false);
    }
  }

  const titleLen = new TextEncoder().encode(title).length;
  const descLen = new TextEncoder().encode(description).length;

  return (
    <div className="max-w-lg mx-auto px-2 sm:px-0">
      <h1 className="text-3xl font-bold mb-2">Create Campaign</h1>
      <p className="text-ink-2 mb-8">
        Start a new crowdfunding campaign on CKB
      </p>

      {!indexerUp && (
        <IndexerWaitNotice phase={indexerPhase} elapsedSeconds={elapsedSeconds} onRetry={retryIndexer} />
      )}

      {!signer && (
        <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
          <p className="text-yellow-800 dark:text-yellow-200 mb-3">
            Connect your wallet to create a campaign
          </p>
          <button
            onClick={open}
            className="px-4 py-2 font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 min-h-[44px]"
          >
            Connect Wallet
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label
            htmlFor="title"
            className="block text-sm font-medium mb-2"
          >
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="title"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (titleError) setTitleError(null);
            }}
            onBlur={validateTitle}
            placeholder="My Awesome Project"
            maxLength={200}
            className={`w-full px-4 py-2 border rounded-lg bg-surface-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              titleError
                ? "border-red-400 dark:border-red-600"
                : "border-line"
            }`}
            disabled={loading}
          />
          <div className="flex justify-between mt-1">
            {titleError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{titleError}</p>
            ) : (
              <p className="text-sm text-ink-3">Give your campaign a memorable name</p>
            )}
            <span
              className={`text-xs ${
                titleLen > 180
                  ? "text-orange-500"
                  : "text-zinc-400"
              }`}
            >
              {titleLen}/200
            </span>
          </div>
        </div>

        <div>
          <label
            htmlFor="description"
            className="block text-sm font-medium mb-2"
          >
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your project and what you plan to achieve..."
            maxLength={2000}
            rows={4}
            className="w-full px-4 py-2 border border-line rounded-lg bg-surface-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical"
            disabled={loading}
          />
          <div className="flex justify-between mt-1">
            <p className="text-sm text-ink-3">Tell backers about your project (stored on-chain)</p>
            <span
              className={`text-xs ${
                descLen > 1800
                  ? "text-orange-500"
                  : "text-zinc-400"
              }`}
            >
              {descLen}/2000
            </span>
          </div>
        </div>

        <div>
          <label htmlFor="category" className="block text-sm font-medium mb-2">
            Category <span className="text-red-500">*</span>
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              if (categoryError) setCategoryError(null);
            }}
            onBlur={validateCategory}
            className={`w-full px-4 py-2 border rounded-lg bg-surface-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              categoryError ? "border-red-400 dark:border-red-600" : "border-line"
            }`}
            disabled={loading}
          >
            <option value="">Choose a category</option>
            {CAMPAIGN_CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
          <div className="mt-1">
            {categoryError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{categoryError}</p>
            ) : (
              <p className="text-sm text-ink-3">Helps backers find your campaign (stored on-chain)</p>
            )}
          </div>
        </div>

        <div>
          <label
            htmlFor="fundingGoal"
            className="block text-sm font-medium mb-2"
          >
            Funding Goal (CKB)
          </label>
          <input
            type="number"
            id="fundingGoal"
            value={fundingGoal}
            onChange={(e) => {
              setFundingGoal(e.target.value);
              if (goalError) setGoalError(null);
            }}
            onBlur={validateGoal}
            placeholder="1000"
            min="100"
            step="1"
            className={`w-full px-4 py-2 border rounded-lg bg-surface-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              goalError
                ? "border-red-400 dark:border-red-600"
                : "border-line"
            }`}
            disabled={loading}
          />
          <div className="mt-1">
            {goalError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{goalError}</p>
            ) : (
              <p className="text-sm text-ink-3">
                Minimum 100 CKB, the same as the smallest pledge
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="deadlineDateTime" className="block text-sm font-medium mb-2">
            Campaign Deadline <span className="text-red-500">*</span>
          </label>
          <input
            type="datetime-local"
            id="deadlineDateTime"
            value={deadlineDateTime}
            min={minDeadline}
            onFocus={() => setMinDeadline(toDatetimeLocal(new Date(Date.now() + MIN_DEADLINE_HOURS * 3600 * 1000)))}
            onChange={(e) => {
              setDeadlineDateTime(e.target.value);
              if (deadlineError) setDeadlineError(null);
            }}
            onBlur={validateDeadline}
            className={`w-full px-4 py-2 border rounded-lg bg-surface-2 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              deadlineError
                ? "border-red-400 dark:border-red-600"
                : "border-line"
            }`}
            disabled={loading}
          />
          <div className="mt-1">
            {deadlineError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{deadlineError}</p>
            ) : (
              <div className="text-sm text-ink-3 space-y-1">
                <p>
                  When the campaign ends, in your local time{timeZone ? ` (${timeZone})` : ""}.
                  At least {MIN_DEADLINE_LABEL} from now.
                </p>
                {currentBlock !== null && deadlineDateTime && (
                  <p className="text-xs text-zinc-400">
                    Current block: #{currentBlock.toLocaleString()}.
                    Estimated deadline block: #{datetimeToBlockNumber(deadlineDateTime, currentBlock).toLocaleString()}.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={!signer || loading}
          className="w-full px-4 py-3 font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
        >
          {loading ? "Creating..." : "Create Campaign"}
        </button>
      </form>
    </div>
  );
}

