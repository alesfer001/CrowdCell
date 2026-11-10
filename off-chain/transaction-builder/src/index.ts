/**
 * Transaction Builder for CKB Kickstarter
 *
 * This module provides utilities to build and send transactions for:
 * - Creating campaigns
 * - Creating pledges
 * - Finalizing campaigns (Active -> Success/Failed)
 * - Refunding pledges (backer reclaims CKB)
 * - Releasing pledges to creators
 */

export { TransactionBuilder, createTransactionBuilder } from "./builder";
export { createCkbClient } from "./ckbClient";
export type { NetworkType } from "./ckbClient";
export { serializeCampaignData, serializePledgeData, calculateCellCapacity, serializeMetadata, getMetadataSize } from "./serializer";
export type { CampaignParams, PledgeParams, ContractInfo, TxResult, CampaignStatus, FinalizeCampaignParams, RefundPledgeParams, ReleasePledgeParams, DestroyCampaignParams } from "./types";
