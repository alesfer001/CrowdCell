import { ccc } from "@ckb-ccc/core";
import { CampaignStatus, CampaignParams, PledgeParams, ContractInfo, TxResult, FinalizeCampaignParams, RefundPledgeParams, ReleasePledgeParams, DestroyCampaignParams, CreatePledgeWithReceiptParams, PermissionlessReleaseParams, PermissionlessRefundParams, MergeContributionsParams, ReclaimReceiptParams } from "./types";
import { serializeCampaignData, serializePledgeData, serializeCampaignDataWithStatus, calculateCellCapacity, getMetadataSize, serializeReceiptData, serializePledgeLockArgs, encodeDeadlineBlockAsLockArgs, serializeCampaignTypeArgs, serializeReceiptTypeArgs, readTotalPledged, withTotalPledged, withCampaignStatus, readFundingGoal, readPledgeAmount } from "./serializer";
import { createCkbClient, NetworkType } from "./ckbClient";

/** Byte length of the v1.2 campaign type script args: TypeID (32) + pledge-lock code hash (32) */
const CAMPAIGN_TYPE_ARGS_SIZE = 64;

/** Smallest pledge the campaign contract accepts (100 CKB), mirrored so callers get a clear error */
const MIN_PLEDGE_AMOUNT = BigInt(100) * BigInt(100000000);

/** Blocks past the deadline before a finalized campaign may be destroyed; matches the campaign contract */
const GRACE_PERIOD_BLOCKS = BigInt(1_944_000);

/** How many times a pledge is retried when another pledge wins the race for the campaign cell */
const PLEDGE_CONTENTION_RETRIES = 4;

/**
 * Did this transaction fail because a cell it spent had already been spent?
 * Two pledges racing for the same campaign cell produce exactly this — the loser holds a
 * dead out point. Same shape as the JoyID stale-UTXO retry shipped in Phase 17.7.
 */
function isStaleCellError(err: unknown): boolean {
  const message = String((err as { message?: string })?.message ?? err).toLowerCase();
  return (
    message.includes("outpoint not found") ||
    message.includes("dead cell") ||
    message.includes("deadcell") ||
    message.includes("unknown output") ||
    message.includes("resolve failed") ||
    // The winner is still in the pool: the node treats the loser as a failed replace-by-fee
    message.includes("poolrejectedrbf")
  );
}

/**
 * Transaction builder for creating campaigns and pledges
 */
export class TransactionBuilder {
  private client: ccc.Client;
  private campaignContract: ContractInfo;
  private campaignLockContract: ContractInfo;
  private pledgeContract: ContractInfo;
  private pledgeLockContract: ContractInfo;
  private receiptContract: ContractInfo;

  constructor(
    client: ccc.Client,
    campaignContract: ContractInfo,
    campaignLockContract: ContractInfo,
    pledgeContract: ContractInfo,
    pledgeLockContract: ContractInfo,
    receiptContract: ContractInfo
  ) {
    this.client = client;
    this.campaignContract = campaignContract;
    this.campaignLockContract = campaignLockContract;
    this.pledgeContract = pledgeContract;
    this.pledgeLockContract = pledgeLockContract;
    this.receiptContract = receiptContract;
  }

  /**
   * Create a campaign transaction
   * @param signer - CCC signer (wallet)
   * @param params - Campaign parameters
   * @returns Transaction hash
   */
  async createCampaign(signer: ccc.Signer, params: CampaignParams): Promise<string> {
    console.log("Building create campaign transaction...");

    // Serialize campaign data
    const campaignData = serializeCampaignData(params);
    console.log(`Campaign data: ${campaignData}`);

    // Calculate required capacity (65 bytes header + metadata)
    const metadataSize = (params.title || params.description) ? getMetadataSize(params.title, params.description) : 0;
    const dataSize = 65 + metadataSize;
    // v1.2: campaign type args are 64 bytes (TypeID + pledge-lock code hash), not 32
    const capacity = calculateCellCapacity(dataSize, true, 65, CAMPAIGN_TYPE_ARGS_SIZE);
    console.log(`Required capacity: ${capacity} shannons (${Number(capacity) / 100000000} CKB)`);

    // Encode deadline block as lock args (8 bytes, LE)
    const deadlineArgs = encodeDeadlineBlockAsLockArgs(params.deadlineBlock);
    console.log(`Deadline block ${params.deadlineBlock} encoded as lock args: ${deadlineArgs}`);

    // Campaign-lock script: code hash + deadline args
    const lockScript = {
      codeHash: this.campaignLockContract.codeHash,
      hashType: this.campaignLockContract.hashType,
      args: deadlineArgs,
    };

    // Build the transaction
    const tx = ccc.Transaction.from({
      outputs: [
        {
          capacity,
          lock: lockScript,
          type: {
            codeHash: this.campaignContract.codeHash,
            hashType: this.campaignContract.hashType,
            // Placeholder — replaced below once the TypeID can be computed from the inputs
            args: "0x" + "00".repeat(CAMPAIGN_TYPE_ARGS_SIZE),
          },
        },
      ],
      outputsData: [campaignData],
      cellDeps: [
        {
          outPoint: {
            txHash: this.campaignLockContract.txHash,
            index: this.campaignLockContract.index,
          },
          depType: "code",
        },
        {
          outPoint: {
            txHash: this.campaignContract.txHash,
            index: this.campaignContract.index,
          },
          depType: "code",
        },
      ],
    });

    // Complete the transaction (add inputs to cover capacity + fee)
    await tx.completeInputsByCapacity(signer);
    await tx.completeFeeBy(signer, 1000); // 1000 shannons/KB fee rate

    // Compute TypeID args: blake2b(molecule_serialized_first_input || output_index_u64_le)
    // Per CKB RFC-0022, TypeID = blake2b(CellInput molecule bytes || u64 LE output index)
    const firstInput = ccc.CellInput.from(tx.inputs[0]);
    const serializedInput = firstInput.toBytes();
    const outputIndexBytes = ccc.numLeToBytes(0, 8); // campaign is output[0]
    const hasher = new ccc.HasherCkb();
    hasher.update(serializedInput);
    hasher.update(outputIndexBytes);
    const typeId = hasher.digest();
    // v1.2: the pledge-lock code hash rides along in args so the campaign type script can
    // recognise the pledge cells it accumulates.
    const typeArgs = serializeCampaignTypeArgs(typeId, this.pledgeLockContract.codeHash);
    tx.outputs[0].type!.args = ccc.hexFrom(typeArgs);
    console.log(`Campaign type args: ${typeArgs} (TypeID ${typeId})`);

    // Sign and send
    console.log("Signing transaction...");
    const txHash = await signer.sendTransaction(tx);
    console.log(`Campaign created! TX: ${txHash}`);

    return txHash;
  }

  /**
   * Create a pledge transaction
   * @param signer - CCC signer (wallet)
   * @param params - Pledge parameters
   * @returns Transaction hash
   */
  async createPledge(signer: ccc.Signer, params: PledgeParams): Promise<string> {
    console.log("Building create pledge transaction...");

    // Serialize pledge data
    const pledgeData = serializePledgeData(params);
    console.log(`Pledge data: ${pledgeData}`);

    // Calculate required capacity (pledge amount + cell overhead)
    const dataSize = 72; // Pledge data structure size
    const baseCapacity = calculateCellCapacity(dataSize, true, 65);
    const totalCapacity = baseCapacity + params.amount; // Base + pledge amount

    console.log(`Required capacity: ${totalCapacity} shannons (${Number(totalCapacity) / 100000000} CKB)`);
    console.log(`  - Base cell: ${baseCapacity} shannons`);
    console.log(`  - Pledge amount: ${params.amount} shannons`);

    // Get the lock script from signer
    const lock = await signer.getRecommendedAddress();
    const lockScript = (await ccc.Address.fromString(lock, this.client)).script;

    // Build the transaction
    const tx = ccc.Transaction.from({
      outputs: [
        {
          capacity: totalCapacity,
          lock: lockScript,
          type: {
            codeHash: this.pledgeContract.codeHash,
            hashType: this.pledgeContract.hashType,
            args: "0x", // No args for now
          },
        },
      ],
      outputsData: [pledgeData],
      cellDeps: [
        {
          outPoint: {
            txHash: this.pledgeContract.txHash,
            index: this.pledgeContract.index,
          },
          depType: "code",
        },
      ],
    });

    // Complete the transaction (add inputs to cover capacity + fee)
    await tx.completeInputsByCapacity(signer);
    await tx.completeFeeBy(signer, 1000); // 1000 shannons/KB fee rate

    // Sign and send
    console.log("Signing transaction...");
    const txHash = await signer.sendTransaction(tx);
    console.log(`Pledge created! TX: ${txHash}`);

    return txHash;
  }

  /**
   * Finalize a campaign (transition from Active to Success/Failed)
   * Consumes the old campaign cell and creates a new one with updated status.
   * Returns excess capacity from the campaign cell to the creator as a change output.
   */
  async finalizeCampaign(signer: ccc.Signer, params: FinalizeCampaignParams): Promise<string> {
    console.log("Building finalize campaign transaction...");

    // The campaign cell's out point moves with every pledge since v1.2, so a caller's out
    // point can be stale by the time it finalizes — the bot's especially, since it comes
    // from the indexer's last cycle. Resolve the live cell by type args instead. Reading
    // the args from the caller's out point still works when that out point is dead: the
    // transaction that created it remains in the chain's history.
    const typeArgs =
      params.campaignTypeArgs ?? (await this.loadCampaignCell(params.campaignOutPoint)).type.args;
    const campaignCell = await this.findLiveCampaignCell(typeArgs);
    const campaign = {
      lock: campaignCell.cellOutput.lock,
      type: campaignCell.cellOutput.type!,
      capacity: campaignCell.cellOutput.capacity,
      data: ccc.hexFrom(campaignCell.outputData),
    };
    const campaignOutPoint = campaignCell.outPoint;

    // v1.2 finalization is a surgical edit of the on-chain data — only the status byte
    // moves. Re-serializing from off-chain values would risk a byte for byte mismatch in
    // the metadata tail, which the type script rejects.
    const totalPledged = readTotalPledged(campaign.data);
    const fundingGoal = readFundingGoal(campaign.data);
    const status = totalPledged >= fundingGoal ? CampaignStatus.Success : CampaignStatus.Failed;
    console.log(`Raised ${totalPledged} against goal ${fundingGoal} -> ${CampaignStatus[status]}`);

    // The caller's expectation is only a cross-check now: the on-chain accumulator decides.
    if (params.newStatus !== undefined && params.newStatus !== status) {
      throw new Error(
        `Requested status ${CampaignStatus[params.newStatus]} contradicts the on-chain total ` +
        `(raised ${totalPledged}, goal ${fundingGoal}). The campaign type script would reject it.`
      );
    }

    const newCampaignData = withCampaignStatus(campaign.data, status);

    // Since value: raw deadline block number (same pattern as pledge-lock)
    // CKB devnet doesn't enforce since at consensus layer; the campaign-lock script
    // reads the since value via load_input_since() and validates against the deadline in args.
    const deadlineBlock = params.campaignData.deadlineBlock;
    const sinceValue = BigInt(deadlineBlock);
    console.log(`Since value for deadline ${deadlineBlock}: ${sinceValue}`);

    // The campaign cell keeps every shannon it had. Skimming the difference — which the old
    // builder did via a "change" output — is now rejected by the type script, because a
    // permissionless finalizer could just as easily have pointed that output at itself.
    const tx = ccc.Transaction.from({
      inputs: [
        {
          previousOutput: campaignOutPoint,
          since: sinceValue,  // Raw deadline block number
        },
      ],
      outputs: [
        {
          capacity: campaign.capacity,
          lock: campaign.lock,
          type: campaign.type,
        },
      ],
      outputsData: [newCampaignData],
      cellDeps: [
        {
          outPoint: {
            txHash: this.campaignLockContract.txHash,
            index: this.campaignLockContract.index,
          },
          depType: "code",
        },
        {
          outPoint: {
            txHash: this.campaignContract.txHash,
            index: this.campaignContract.index,
          },
          depType: "code",
        },
      ],
    });

    // Add empty witness for the campaign cell input (custom lock, no signature needed)
    tx.witnesses.push("0x");

    // completeFeeBy adds a signer input for the fee but under-estimates the tx size
    // because it doesn't account for the witness that sendTransaction will add for
    // the signer's secp256k1 lock. Use a higher fee rate (2x) to compensate.
    await tx.completeFeeBy(signer, 2000);

    console.log("Signing finalize transaction...");
    const txHash = await signer.sendTransaction(tx);
    console.log(`Campaign finalized! TX: ${txHash}`);

    return txHash;
  }

  /**
   * Load a campaign cell's script, capacity and raw data from its out point.
   */
  private async loadCampaignCell(outPoint: { txHash: string; index: number }): Promise<{
    lock: { codeHash: string; hashType: string; args: string };
    type: { codeHash: string; hashType: string; args: string };
    capacity: bigint;
    data: string;
  }> {
    const tx = await this.client.getTransaction(outPoint.txHash);
    if (!tx?.transaction) {
      throw new Error(`Campaign transaction ${outPoint.txHash} not found`);
    }
    const output = tx.transaction.outputs[outPoint.index];
    const data = tx.transaction.outputsData[outPoint.index];
    if (!output || !output.type) {
      throw new Error(`No campaign cell at ${outPoint.txHash}:${outPoint.index}`);
    }
    return {
      lock: {
        codeHash: ccc.hexFrom(output.lock.codeHash),
        hashType: output.lock.hashType as string,
        args: ccc.hexFrom(output.lock.args),
      },
      type: {
        codeHash: ccc.hexFrom(output.type.codeHash),
        hashType: output.type.hashType as string,
        args: ccc.hexFrom(output.type.args),
      },
      capacity: BigInt(output.capacity),
      data: ccc.hexFrom(data),
    };
  }

  /**
   * Find the live campaign cell for a given set of campaign type args.
   *
   * Since v1.2 every pledge consumes and re-creates the campaign cell, so its out point
   * moves constantly. The type args (TypeID + pledge-lock code hash) are the campaign's
   * stable identity, and this is how a caller holding a stale out point recovers.
   */
  async findLiveCampaignCell(campaignTypeArgs: string): Promise<ccc.Cell> {
    const searchKey = {
      script: {
        codeHash: this.campaignContract.codeHash,
        hashType: this.campaignContract.hashType as any,
        args: campaignTypeArgs,
      },
      scriptType: "type" as const,
      scriptSearchMode: "exact" as const,
    };

    // Query the chain, not the client cache. The cache remembers cells created by this
    // client's own transactions, so after this wallet pledged, it would keep returning the
    // campaign cell that pledge created even once someone else (another backer, the bot's
    // finalization) has spent it.
    for await (const cell of this.client.findCellsOnChain({ ...searchKey, withData: true }, "asc", 1)) {
      return cell;
    }
    throw new Error(`No live campaign cell for type args ${campaignTypeArgs}`);
  }

  /**
   * Refund a pledge (backer reclaims their CKB)
   * Consumes the pledge cell, creates a plain output (no type script) back to the backer.
   */
  async refundPledge(signer: ccc.Signer, params: RefundPledgeParams): Promise<string> {
    console.log("Building refund pledge transaction...");

    // Get the backer's lock script
    const address = await signer.getRecommendedAddress();
    const lockScript = (await ccc.Address.fromString(address, this.client)).script;

    // Build the transaction: consume pledge cell, return CKB to backer (no type script)
    const tx = ccc.Transaction.from({
      inputs: [
        {
          previousOutput: {
            txHash: params.pledgeOutPoint.txHash,
            index: params.pledgeOutPoint.index,
          },
        },
      ],
      outputs: [
        {
          capacity: params.pledgeCapacity,
          lock: lockScript,
          // No type script — plain CKB cell
        },
      ],
      outputsData: ["0x"],
      cellDeps: [
        {
          outPoint: {
            txHash: this.pledgeContract.txHash,
            index: this.pledgeContract.index,
          },
          depType: "code",
        },
      ],
    });

    // Complete fee
    await tx.completeFeeBy(signer, 1000);

    console.log("Signing refund transaction...");
    const txHash = await signer.sendTransaction(tx);
    console.log(`Pledge refunded! TX: ${txHash}`);

    return txHash;
  }

  /**
   * Release a pledge to the campaign creator
   * Consumes the pledge cell, creates a plain output to the creator's address.
   */
  async releasePledgeToCreator(signer: ccc.Signer, params: ReleasePledgeParams): Promise<string> {
    console.log("Building release pledge transaction...");

    // Get the creator's lock script from their address
    const creatorLockScript = (await ccc.Address.fromString(params.creatorAddress, this.client)).script;

    // Get the backer's lock script (for change)
    const backerAddress = await signer.getRecommendedAddress();
    const backerLockScript = (await ccc.Address.fromString(backerAddress, this.client)).script;

    // Build the transaction: consume pledge cell, send CKB to creator (no type script)
    const tx = ccc.Transaction.from({
      inputs: [
        {
          previousOutput: {
            txHash: params.pledgeOutPoint.txHash,
            index: params.pledgeOutPoint.index,
          },
        },
      ],
      outputs: [
        {
          capacity: params.pledgeCapacity,
          lock: creatorLockScript,
          // No type script — plain CKB cell
        },
      ],
      outputsData: ["0x"],
      cellDeps: [
        {
          outPoint: {
            txHash: this.pledgeContract.txHash,
            index: this.pledgeContract.index,
          },
          depType: "code",
        },
      ],
    });

    // Complete fee (backer pays)
    await tx.completeFeeBy(signer, 1000);

    console.log("Signing release transaction...");
    const txHash = await signer.sendTransaction(tx);
    console.log(`Pledge released to creator! TX: ${txHash}`);

    return txHash;
  }

  /**
   * Destroy a finalized campaign cell (reclaim CKB capacity)
   * Consumes the campaign cell, creates a plain output (no type script) back to the creator.
   * Only valid once the grace period past the deadline has elapsed (~180 days); before that
   * the node rejects the since as immature.
   */
  async destroyCampaign(signer: ccc.Signer, params: DestroyCampaignParams): Promise<string> {
    console.log("Building destroy campaign transaction...");

    const campaignCell = await this.client.getCell(params.campaignOutPoint);
    if (!campaignCell) {
      throw new Error(`No campaign cell at ${params.campaignOutPoint.txHash}:${params.campaignOutPoint.index}`);
    }
    // deadline_block sits after creator_lock_hash (32) + funding_goal (8)
    const deadlineBlock = ccc.numLeFromBytes(ccc.bytesFrom(campaignCell.outputData).slice(40, 48));

    const address = await signer.getRecommendedAddress();
    const lockScript = (await ccc.Address.fromString(address, this.client)).script;

    // The campaign-lock needs since >= deadline and the campaign type script needs
    // since >= deadline + grace period, so one since satisfies both. The whole capacity goes
    // back to the creator, less the fee, which the type script allows up to 1 CKB.
    const tx = ccc.Transaction.from({
      inputs: [{ previousOutput: campaignCell.outPoint, since: deadlineBlock + GRACE_PERIOD_BLOCKS }],
      outputs: [{ capacity: campaignCell.cellOutput.capacity, lock: lockScript }],
      outputsData: ["0x"],
      cellDeps: [this.campaignContract, this.campaignLockContract].map((c) => ({
        outPoint: { txHash: c.txHash, index: c.index },
        depType: "code" as const,
      })),
    });
    tx.witnesses.push("0x");

    await tx.completeFeeChangeToOutput(signer, 0, 1000);

    console.log("Signing destroy transaction...");
    const txHash = await signer.sendTransaction(tx);
    console.log(`Campaign destroyed! TX: ${txHash}`);

    return txHash;
  }

  /**
   * Create a pledge with receipt (v1.1 trustless model)
   * Produces: [0] pledge cell with custom pledge lock, [1] receipt cell owned by backer
   */
  async createPledgeWithReceipt(signer: ccc.Signer, params: CreatePledgeWithReceiptParams): Promise<string> {
    if (params.amount < MIN_PLEDGE_AMOUNT) {
      throw new Error(`Pledge of ${params.amount} shannons is below the ${MIN_PLEDGE_AMOUNT} shannon (100 CKB) minimum`);
    }

    // v1.2: a pledge now also consumes and re-creates the campaign cell with a larger
    // total_pledged. That makes pledges contend for one cell, so a pledge that loses the
    // race is retried against the winner's fresh campaign cell rather than failing.
    const typeArgs =
      params.campaignTypeArgs ?? (await this.loadCampaignCell(params.campaignOutPoint)).type.args;

    let lastError: unknown;
    for (let attempt = 1; attempt <= PLEDGE_CONTENTION_RETRIES; attempt++) {
      const campaignCell = await this.findLiveCampaignCell(typeArgs);
      try {
        return await this.submitPledgeWithReceipt(signer, params, campaignCell);
      } catch (err) {
        lastError = err;
        if (attempt === PLEDGE_CONTENTION_RETRIES || !isStaleCellError(err)) {
          throw err;
        }
        console.warn(
          `Pledge attempt ${attempt} lost the race for the campaign cell, retrying...`
        );
        await this.waitForCampaignCellToMove(typeArgs, campaignCell.outPoint);
      }
    }
    throw lastError;
  }

  /**
   * Wait until the live campaign cell is no longer `spent`, so a retried pledge doesn't
   * rebuild on the same cell. The live cell is read from the chain, which only moves once
   * the winning pledge commits, so a fixed short delay is not enough. Gives up quietly after
   * the timeout and lets the caller retry anyway.
   */
  private async waitForCampaignCellToMove(campaignTypeArgs: string, spent: ccc.OutPoint, timeoutMs = 60000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const cell = await this.findLiveCampaignCell(campaignTypeArgs);
      if (!cell.outPoint.eq(spent)) return;
    }
  }

  /**
   * Build and send one pledge transaction against a specific campaign cell.
   *
   * Inputs:  campaign cell (+ the backer's cells for capacity and fee)
   * Outputs: campaign cell with total_pledged increased by the pledge amount,
   *          pledge cell under the pledge lock, receipt cell owned by the backer
   */
  private async submitPledgeWithReceipt(
    signer: ccc.Signer,
    params: CreatePledgeWithReceiptParams,
    campaignCell: ccc.Cell
  ): Promise<string> {
    console.log("Building create pledge with receipt transaction...");

    const campaignTypeScript = ccc.Script.from(campaignCell.cellOutput.type!);
    const campaignTypeScriptHash = campaignTypeScript.hash();
    if (
      params.campaignTypeScriptHash &&
      params.campaignTypeScriptHash.toLowerCase() !== campaignTypeScriptHash.toLowerCase()
    ) {
      throw new Error(
        `Campaign type script hash mismatch: caller passed ${params.campaignTypeScriptHash}, ` +
        `live cell hashes to ${campaignTypeScriptHash}`
      );
    }

    // Accumulator update: bump total_pledged, leave every other byte of the campaign data
    // untouched (the type script requires a byte-identical tail).
    const campaignData = ccc.hexFrom(campaignCell.outputData);
    const newTotal = readTotalPledged(campaignData) + params.amount;
    const newCampaignData = withTotalPledged(campaignData, newTotal);
    console.log(`  Campaign total_pledged: ${readTotalPledged(campaignData)} -> ${newTotal}`);

    // Serialize pledge cell data (72 bytes): campaign_id + backer_lock_hash + amount
    const pledgeData = serializePledgeData({
      campaignId: params.campaignId,
      backerLockHash: params.backerLockHash,
      amount: params.amount,
    });

    // Serialize receipt cell data (80 bytes): pledge_amount + backer_lock_hash + campaign + deadline
    const receiptData = serializeReceiptData(
      params.amount,
      params.backerLockHash,
      campaignTypeScriptHash,
      params.deadlineBlock
    );

    // Serialize pledge lock args (72 bytes): campaign_type_script_hash + deadline + backer_lock_hash
    const pledgeLockArgs = serializePledgeLockArgs(
      campaignTypeScriptHash,
      params.deadlineBlock,
      params.backerLockHash
    );

    // Calculate capacities
    const pledgeDataSize = 72;
    const pledgeBaseCapacity = calculateCellCapacity(pledgeDataSize, true, 65);
    const pledgeTotalCapacity = pledgeBaseCapacity + params.amount;

    const receiptDataSize = 80;
    const receiptCapacity = calculateCellCapacity(receiptDataSize, true, 65, 64);

    // Get backer's lock script (backer owns the receipt cell)
    const backerAddress = await signer.getRecommendedAddress();
    const backerLockScript = (await ccc.Address.fromString(backerAddress, this.client)).script;

    console.log(`  Pledge capacity: ${pledgeTotalCapacity} shannons`);
    console.log(`  Receipt capacity: ${receiptCapacity} shannons`);

    // Build the transaction with cross-referencing args
    // Pledge type script args = receipt type script hash (32 bytes)
    // Receipt type script args = pledge code hash + pledge-lock code hash (64 bytes)
    const pledgeTypeScriptArgs = ccc.hexFrom(this.receiptContract.codeHash.slice(2)); // Remove 0x prefix
    const receiptTypeScriptArgs = serializeReceiptTypeArgs(this.pledgeContract.codeHash, this.pledgeLockContract.codeHash)

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
            codeHash: this.pledgeLockContract.codeHash,
            hashType: this.pledgeLockContract.hashType,
            args: pledgeLockArgs,
          },
          type: {
            codeHash: this.pledgeContract.codeHash,
            hashType: this.pledgeContract.hashType,
            args: pledgeTypeScriptArgs,
          },
        },
        {
          // [2] Receipt cell owned by backer
          capacity: receiptCapacity,
          lock: backerLockScript,
          type: {
            codeHash: this.receiptContract.codeHash,
            hashType: this.receiptContract.hashType,
            args: receiptTypeScriptArgs,
          },
        },
      ],
      outputsData: [newCampaignData, pledgeData, receiptData],
      cellDeps: [
        {
          outPoint: {
            txHash: this.pledgeContract.txHash,
            index: this.pledgeContract.index,
          },
          depType: "code",
        },
        {
          outPoint: {
            txHash: this.pledgeLockContract.txHash,
            index: this.pledgeLockContract.index,
          },
          depType: "code",
        },
        {
          outPoint: {
            txHash: this.receiptContract.txHash,
            index: this.receiptContract.index,
          },
          depType: "code",
        },
        {
          // Campaign type script — now executes, it validates the accumulator update
          outPoint: {
            txHash: this.campaignContract.txHash,
            index: this.campaignContract.index,
          },
          depType: "code",
        },
        {
          // Campaign lock script — now executes, the campaign cell is an input
          outPoint: {
            txHash: this.campaignLockContract.txHash,
            index: this.campaignLockContract.index,
          },
          depType: "code",
        },
      ],
    });

    // Empty witness for the campaign cell input (custom lock, no signature needed)
    tx.witnesses.push("0x");

    // Complete inputs and fee (backer's cells)
    await tx.completeInputsByCapacity(signer);
    await tx.completeFeeBy(signer, 2000);

    console.log("Signing pledge with receipt transaction...");
    const txHash = await signer.sendTransaction(tx);
    console.log(`Pledge with receipt created! TX: ${txHash}`);

    return txHash;
  }

  /**
   * Permissionless release: anyone triggers after deadline when campaign succeeded.
   * Pledge lock routes funds to creator's lock script.
   * The signer only provides fee cells -- the pledge cell is an explicit input.
   */
  async permissionlessRelease(signer: ccc.Signer, params: PermissionlessReleaseParams): Promise<string> {
    console.log("Building permissionless release transaction...");

    // Since value: absolute block number for deadline enforcement
    const sinceValue = params.deadlineBlock;

    // The creator receives exactly the pledged amount. The rest of the cell is the backer's
    // storage overhead and goes back to them, less the fee (pledge lock allows up to 1 CKB).
    const txFee = BigInt(100000); // 0.001 CKB
    const creatorLock = ccc.Script.from({
      codeHash: params.creatorLockScript.codeHash,
      hashType: params.creatorLockScript.hashType as ccc.HashTypeLike,
      args: params.creatorLockScript.args,
    });
    const { amount: pledgeAmount, backerLock } = await this.resolvePledgeRouting(params);
    if (pledgeAmount > params.pledgeCapacity) {
      throw new Error(`Pledge amount ${pledgeAmount} exceeds cell capacity ${params.pledgeCapacity}`);
    }

    // A creator backing their own campaign: one output, both shares land in the same wallet
    const outputs = creatorLock.eq(backerLock)
      ? [{ capacity: params.pledgeCapacity - txFee, lock: creatorLock }]
      : [
          { capacity: pledgeAmount, lock: creatorLock },
          { capacity: params.pledgeCapacity - pledgeAmount - txFee, lock: backerLock },
        ];

    const tx = ccc.Transaction.from({
      inputs: [
        {
          // Pledge cell with custom pledge lock (explicit input, not from signer)
          previousOutput: {
            txHash: params.pledgeOutPoint.txHash,
            index: params.pledgeOutPoint.index,
          },
          since: sinceValue,
        },
      ],
      outputs,
      outputsData: outputs.map(() => "0x"),
      cellDeps: [
        {
          // Campaign cell (status = Success, for pledge lock verification)
          outPoint: {
            txHash: params.campaignCellDep.txHash,
            index: params.campaignCellDep.index,
          },
          depType: "code",
        },
        {
          outPoint: {
            txHash: this.pledgeLockContract.txHash,
            index: this.pledgeLockContract.index,
          },
          depType: "code",
        },
        {
          outPoint: {
            txHash: this.pledgeContract.txHash,
            index: this.pledgeContract.index,
          },
          depType: "code",
        },
      ],
    });

    console.log("Signing permissionless release transaction...");
    const txHash = await signer.sendTransaction(tx);
    console.log(`Permissionless release completed! TX: ${txHash}`);

    return txHash;
  }

  /**
   * The pledged amount and the backer's full lock script for a release.
   * The pledge cell only stores the backer's lock *hash* (in its lock args), so when the
   * caller has no lock script it is looked up among the outputs of the transaction that
   * created the pledge cell, which always pays the backer something (receipt or change).
   */
  private async resolvePledgeRouting(
    params: PermissionlessReleaseParams
  ): Promise<{ amount: bigint; backerLock: ccc.Script }> {
    const needsChain = params.pledgeAmount === undefined || !params.backerLockScript;
    const pledgeTx = needsChain ? await this.client.getTransaction(params.pledgeOutPoint.txHash) : undefined;
    if (needsChain && !pledgeTx?.transaction) {
      throw new Error(`Pledge transaction ${params.pledgeOutPoint.txHash} not found`);
    }

    const amount =
      params.pledgeAmount ??
      readPledgeAmount(ccc.hexFrom(pledgeTx!.transaction!.outputsData[params.pledgeOutPoint.index]));

    if (params.backerLockScript) {
      return {
        amount,
        backerLock: ccc.Script.from({
          codeHash: params.backerLockScript.codeHash,
          hashType: params.backerLockScript.hashType as ccc.HashTypeLike,
          args: params.backerLockScript.args,
        }),
      };
    }

    const pledgeLockArgs = ccc.bytesFrom(pledgeTx!.transaction!.outputs[params.pledgeOutPoint.index].lock.args);
    const backerLockHash = ccc.hexFrom(pledgeLockArgs.slice(40, 72));
    const backerLock = pledgeTx!.transaction!.outputs
      .map((o) => o.lock)
      .find((lock) => lock.hash() === backerLockHash);
    if (!backerLock) {
      throw new Error(`Backer lock script for ${backerLockHash} not found in the pledge transaction; pass backerLockScript`);
    }
    return { amount, backerLock };
  }

  /**
   * Reclaim a receipt cell's capacity once its campaign is finalized.
   *
   * The receipt is locked by the backer, so the backer signs. With the finalized campaign
   * cell as a cell dep the receipt type script allows destruction on its own — the pledge
   * has already been (or will be) routed by the pledge lock. The fee comes out of the
   * receipt, so the backer needs no other cells.
   */
  async reclaimReceipt(signer: ccc.Signer, params: ReclaimReceiptParams): Promise<string> {
    console.log("Building reclaim receipt transaction...");

    const receiptTx = await this.client.getTransaction(params.receiptOutPoint.txHash);
    const receiptOutput = receiptTx?.transaction?.outputs[params.receiptOutPoint.index];
    if (!receiptOutput) {
      throw new Error(`Receipt cell ${params.receiptOutPoint.txHash}:${params.receiptOutPoint.index} not found`);
    }

    const tx = ccc.Transaction.from({
      inputs: [{ previousOutput: params.receiptOutPoint }],
      outputs: [{ capacity: receiptOutput.capacity, lock: receiptOutput.lock }],
      outputsData: ["0x"],
      cellDeps: [
        { outPoint: params.campaignCellDep, depType: "code" },
        {
          outPoint: { txHash: this.receiptContract.txHash, index: this.receiptContract.index },
          depType: "code",
        },
      ],
    });

    await tx.completeFeeChangeToOutput(signer, 0, 1000);
    const txHash = await signer.sendTransaction(tx);
    console.log(`Receipt reclaimed! TX: ${txHash}`);
    return txHash;
  }

  /**
   * Permissionless refund: triggered after deadline when campaign failed.
   * Pledge lock routes funds to backer. Receipt is not consumed.
   * No backer signature needed — any wallet can trigger the refund.
   */
  async permissionlessRefund(signer: ccc.Signer, params: PermissionlessRefundParams): Promise<string> {
    console.log("Building permissionless refund transaction...");

    // Since value for pledge cell: absolute block number >= deadline
    const sinceValue = params.deadlineBlock;

    // Total capacity returned to backer: pledge capacity (minus small fee)
    const txFee = BigInt(100000); // 0.001 CKB fee — within MAX_FEE (1 CKB)
    const backerOutputCapacity = params.pledgeCapacity - txFee;

    // Build cell deps
    const cellDeps: Array<{ outPoint: { txHash: string; index: number }; depType: "code" | "depGroup" }> = [
      {
        outPoint: {
          txHash: this.pledgeLockContract.txHash,
          index: this.pledgeLockContract.index,
        },
        depType: "code",
      },
      {
        outPoint: {
          txHash: this.pledgeContract.txHash,
          index: this.pledgeContract.index,
        },
        depType: "code",
      },
    ];

    // Campaign cell_dep is optional (fail-safe refund works without it)
    if (params.campaignCellDep) {
      cellDeps.push({
        outPoint: {
          txHash: params.campaignCellDep.txHash,
          index: params.campaignCellDep.index,
        },
        depType: "code",
      });
    }

    // Build the transaction
    const tx = ccc.Transaction.from({
      inputs: [
        {
          // Pledge cell (custom pledge lock)
          previousOutput: {
            txHash: params.pledgeOutPoint.txHash,
            index: params.pledgeOutPoint.index,
          },
          since: sinceValue,
        },
      ],
      outputs: [
        {
          // Backer receives refund
          capacity: backerOutputCapacity,
          lock: {
            codeHash: params.backerLockScript.codeHash,
            hashType: params.backerLockScript.hashType as "type" | "data" | "data1" | "data2",
            args: params.backerLockScript.args,
          },
        },
      ],
      outputsData: ["0x"],
      cellDeps,
    });

    console.log("Signing permissionless refund transaction...");
    const txHash = await signer.sendTransaction(tx);
    console.log(`Permissionless refund completed! TX: ${txHash}`);

    return txHash;
  }

  /**
   * Merge N pledge cells into 1 (same backer, same campaign)
   * All pledge cells must have identical pledge lock args.
   * Since=0 means merge is allowed before deadline.
   */
  async mergeContributions(signer: ccc.Signer, params: MergeContributionsParams): Promise<string> {
    console.log(`Building merge contributions transaction (${params.pledgeOutPoints.length} inputs)...`);

    if (params.pledgeOutPoints.length < 2) {
      throw new Error("Merge requires at least 2 pledge cells");
    }
    if (params.pledgeOutPoints.length !== params.pledgeCapacities.length) {
      throw new Error("pledgeOutPoints and pledgeCapacities must have the same length");
    }

    // All inputs: pledge cells with since=0 (before-deadline merge path)
    const inputs = params.pledgeOutPoints.map((outPoint) => ({
      previousOutput: {
        txHash: outPoint.txHash,
        index: outPoint.index,
      },
      since: BigInt(0),
    }));

    // Sum all capacities for the merged output (no fee deduction — merge preserves capacity exactly)
    const totalCapacity = params.pledgeCapacities.reduce((sum, cap) => sum + cap, BigInt(0));

    // Serialize merged pledge data
    const mergedPledgeData = serializePledgeData({
      campaignId: params.campaignId,
      backerLockHash: params.backerLockHash,
      amount: params.totalAmount,
    });

    console.log(`  Total capacity: ${totalCapacity} shannons`);
    console.log(`  Total amount: ${params.totalAmount} shannons`);

    // Build the transaction
    const tx = ccc.Transaction.from({
      inputs,
      outputs: [
        {
          // Merged pledge cell: same lock and type as inputs
          capacity: totalCapacity,
          lock: {
            codeHash: this.pledgeLockContract.codeHash,
            hashType: this.pledgeLockContract.hashType,
            args: params.pledgeLockArgs,
          },
          type: {
            // Same type script as the inputs (args = receipt code hash). The pledge lock
            // rejects a merge whose output type differs: with different args the pledge type
            // script would see the inputs and output in separate groups and skip its
            // amount-sum check.
            codeHash: this.pledgeContract.codeHash,
            hashType: this.pledgeContract.hashType,
            args: this.receiptContract.codeHash,
          },
        },
      ],
      outputsData: [mergedPledgeData],
      cellDeps: [
        {
          outPoint: {
            txHash: this.pledgeLockContract.txHash,
            index: this.pledgeLockContract.index,
          },
          depType: "code",
        },
        {
          outPoint: {
            txHash: this.pledgeContract.txHash,
            index: this.pledgeContract.index,
          },
          depType: "code",
        },
      ],
    });

    // Add a separate fee cell from the signer (must not touch the merge output capacity)
    await tx.addCellDepsOfKnownScripts(this.client, ccc.KnownScript.Secp256k1Blake160);
    await tx.completeInputsByCapacity(signer);
    await tx.completeFeeBy(signer, 1000);

    // Restore merge output capacity (completeFeeBy may have adjusted it)
    tx.outputs[0].capacity = totalCapacity;

    console.log("Signing merge contributions transaction...");
    const txHash = await signer.sendTransaction(tx);
    console.log(`Pledge cells merged! TX: ${txHash}`);

    return txHash;
  }

  /**
   * Helper: Get campaign lock contract info
   */
  getCampaignLockContract(): ContractInfo {
    return this.campaignLockContract;
  }

  /**
   * Helper: Get lock hash from address
   */
  async getLockHashFromAddress(address: string): Promise<string> {
    const addr = await ccc.Address.fromString(address, this.client);
    return addr.script.hash();
  }

  /**
   * Helper: Wait for transaction confirmation
   */
  async waitForTransaction(txHash: string, timeout: number = 60000): Promise<void> {
    console.log(`Waiting for transaction ${txHash} to be confirmed...`);

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const tx = await this.client.getTransaction(txHash);
        if (tx && tx.status === "committed") {
          console.log("Transaction confirmed!");
          return;
        }
      } catch (error) {
        // Transaction not found yet, continue waiting
      }

      // Wait 3 seconds before checking again
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    throw new Error(`Transaction ${txHash} not confirmed after ${timeout}ms`);
  }
}

/**
 * Create a transaction builder instance
 *
 * @param rpcUrl - RPC URL for the CKB node
 * @param campaignContract - Campaign contract info
 * @param campaignLockContract - Campaign lock contract info (v1.1)
 * @param pledgeContract - Pledge contract info
 * @param pledgeLockContract - Pledge lock contract info (v1.1)
 * @param receiptContract - Receipt contract info (v1.1)
 * @param network - Network type: "devnet" | "testnet" | "mainnet" (default: auto-detect from rpcUrl)
 */
export function createTransactionBuilder(
  rpcUrl: string,
  campaignContract: ContractInfo,
  campaignLockContract: ContractInfo,
  pledgeContract: ContractInfo,
  pledgeLockContract: ContractInfo,
  receiptContract: ContractInfo,
  network?: NetworkType
): TransactionBuilder {
  // Auto-detect network if not explicitly specified
  const resolvedNetwork = network ?? (
    (rpcUrl.includes("127.0.0.1") || rpcUrl.includes("localhost")) ? "devnet" : "testnet"
  );

  const client = createCkbClient(resolvedNetwork, rpcUrl);
  return new TransactionBuilder(client, campaignContract, campaignLockContract, pledgeContract, pledgeLockContract, receiptContract);
}
