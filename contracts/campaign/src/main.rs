#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
// By default, the following heap configuration is used:
// * 16KB fixed heap
// * 1.2MB(rounded up to be 16-byte aligned) dynamic heap
// * Minimal memory block in dynamic heap is 64 bytes
// For more details, please refer to ckb-std's default_alloc macro
// and the buddy-alloc alloc implementation.
ckb_std::default_alloc!(16384, 1258306, 64);

use ckb_std::{
    debug,
    high_level::{
        load_script, load_script_hash, load_cell_data, load_cell_capacity, load_cell_lock,
        load_cell_occupied_capacity, load_cell_lock_hash, load_input_since,
    },
    ckb_constants::Source,
    error::SysError,
    type_id::check_type_id,
    since::{Since, LockValue},
};

/// Error codes
const ERROR_NO_SCRIPT: i8 = 7;
const ERROR_LOAD_DATA: i8 = 9;
const ERROR_INVALID_FINALIZATION: i8 = 10;
#[allow(dead_code)]
const ERROR_MODIFICATION_NOT_ALLOWED: i8 = 11;
const ERROR_INVALID_TYPE_ID: i8 = 12;
const ERROR_DESTRUCTION_NOT_ALLOWED: i8 = 13;
const ERROR_LOAD_SINCE: i8 = 14;
// v1.2 Phase 8 — accumulator + on-chain status verification
const ERROR_INVALID_ARGS: i8 = 15;
const ERROR_INVALID_PLEDGE_UPDATE: i8 = 16;
const ERROR_CAPACITY_DECREASED: i8 = 17;
const ERROR_STATUS_NOT_JUSTIFIED: i8 = 18;
const ERROR_OVERFLOW: i8 = 19;
const ERROR_LOAD_CELL: i8 = 20;
const ERROR_MULTIPLE_CAMPAIGN_CELLS: i8 = 21;
const ERROR_PLEDGE_UNDERFUNDED: i8 = 22;
const ERROR_PLEDGE_BELOW_MINIMUM: i8 = 23;
const ERROR_CREATOR_NOT_PAID: i8 = 24;
const ERROR_DESTRUCTION_WITH_PLEDGES: i8 = 25;
const ERROR_PLEDGE_DEADLINE_MISMATCH: i8 = 26;

/// Smallest pledge a campaign accepts: 100 CKB.
/// A released pledge pays the creator exactly its amount in its own cell, and a cell needs
/// 61+ CKB to exist (more for locks with longer args, such as JoyID). Below this a pledge
/// could count toward the goal yet never be releasable to the creator.
const MIN_PLEDGE_AMOUNT: u64 = 100 * 100_000_000;

/// Fee a campaign cell may lose when it is destroyed and returned to the creator (1 CKB)
const MAX_FEE: u64 = 100_000_000;

/// Grace period: ~180 days at 8s/block = 1,944,000 blocks
/// A finalized campaign cell can only be destroyed after this period past deadline,
/// so that the pledge-lock grace-period fail-safe is already open for every backer
/// by the time the campaign cell (and with it the cell_dep settlement path) is gone.
const GRACE_PERIOD_BLOCKS: u64 = 1_944_000;

/// Campaign type script args layout (64 bytes):
/// - type_id:               [u8; 32] (bytes 0-31)  — TypeID, validated by check_type_id
/// - pledge_lock_code_hash: [u8; 32] (bytes 32-63) — code hash of the pledge-lock contract
///
/// The pledge-lock code hash lets this script recognise which cells in a transaction are
/// pledges belonging to this campaign, which is what makes the on-chain accumulator possible.
/// It lives in args rather than as a compiled-in constant so the two contracts can be
/// redeployed independently.
const CAMPAIGN_ARGS_SIZE: usize = 64;

/// Offset of the pledge amount inside pledge cell data (72 bytes total).
const PLEDGE_DATA_SIZE: usize = 72;
const PLEDGE_AMOUNT_OFFSET: usize = 64;

/// Campaign status enum
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CampaignStatus {
    Active = 0,
    Success = 1,
    Failed = 2,
}

/// Campaign data structure (stored in cell data)
/// Layout (total: 65 bytes):
/// - creator_lock_hash: [u8; 32]  (bytes 0-31)
/// - funding_goal: u64            (bytes 32-39)
/// - deadline_block: u64          (bytes 40-47)
/// - total_pledged: u64           (bytes 48-55)
/// - status: u8                   (byte 56)
/// - reserved: [u8; 8]            (bytes 57-64) for future use
pub struct CampaignData {
    pub creator_lock_hash: [u8; 32],
    pub funding_goal: u64,
    pub deadline_block: u64,
    pub total_pledged: u64,
    pub status: CampaignStatus,
}

impl CampaignData {
    pub const SIZE: usize = 65;

    /// Parse campaign data from bytes
    pub fn from_bytes(data: &[u8]) -> Result<Self, i8> {
        if data.len() < Self::SIZE {
            debug!("Campaign data too short: {} bytes", data.len());
            return Err(1);
        }

        let mut creator_lock_hash = [0u8; 32];
        creator_lock_hash.copy_from_slice(&data[0..32]);

        let funding_goal = u64::from_le_bytes(data[32..40].try_into().unwrap());
        let deadline_block = u64::from_le_bytes(data[40..48].try_into().unwrap());
        let total_pledged = u64::from_le_bytes(data[48..56].try_into().unwrap());

        let status = match data[56] {
            0 => CampaignStatus::Active,
            1 => CampaignStatus::Success,
            2 => CampaignStatus::Failed,
            _ => {
                debug!("Invalid campaign status: {}", data[56]);
                return Err(2);
            }
        };

        Ok(CampaignData {
            creator_lock_hash,
            funding_goal,
            deadline_block,
            total_pledged,
            status,
        })
    }

    /// Convert campaign data to bytes
    pub fn to_bytes(&self) -> [u8; Self::SIZE] {
        let mut bytes = [0u8; Self::SIZE];
        bytes[0..32].copy_from_slice(&self.creator_lock_hash);
        bytes[32..40].copy_from_slice(&self.funding_goal.to_le_bytes());
        bytes[40..48].copy_from_slice(&self.deadline_block.to_le_bytes());
        bytes[48..56].copy_from_slice(&self.total_pledged.to_le_bytes());
        bytes[56] = self.status as u8;
        // bytes[57..65] reserved for future use
        bytes
    }

    /// Validate campaign creation
    pub fn validate_creation(&self) -> Result<(), i8> {
        // Funding goal must be greater than 0
        if self.funding_goal == 0 {
            debug!("Invalid funding goal: must be > 0");
            return Err(3);
        }

        // Deadline must be in the future (we'll check against current block in the transaction)
        // For now, just ensure it's not zero
        if self.deadline_block == 0 {
            debug!("Invalid deadline: must be > 0");
            return Err(4);
        }

        // New campaigns must start with 0 pledged
        if self.total_pledged != 0 {
            debug!("New campaign must have total_pledged = 0");
            return Err(5);
        }

        // New campaigns must be in Active status
        if self.status != CampaignStatus::Active {
            debug!("New campaign must have Active status");
            return Err(6);
        }

        Ok(())
    }
}

/// Count the cells belonging to this script group in `source`.
fn count_group_cells(source: Source) -> Result<usize, i8> {
    let mut count = 0;
    for i in 0.. {
        match load_cell_data(i, source) {
            Ok(_) => count += 1,
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ERROR_LOAD_DATA),
        }
    }
    Ok(count)
}

/// A pledge's lock carries its own copy of the deadline (lock args bytes 32-40), and that
/// copy is the one pledge-lock enforces on release and refund. It must be the campaign's.
/// Otherwise a pledge with deadline 0 counts toward the goal, then the pledge-lock grace
/// fallback refunds it at once with no campaign cell_dep, and the total never comes down.
fn check_pledge_deadline(lock_args: &[u8], campaign_deadline: u64) -> Result<(), i8> {
    if lock_args.len() < 40 {
        return Err(ERROR_PLEDGE_DEADLINE_MISMATCH);
    }
    let pledge_deadline = u64::from_le_bytes(lock_args[32..40].try_into().unwrap());
    if pledge_deadline != campaign_deadline {
        debug!("Pledge lock deadline {} != campaign deadline {}", pledge_deadline, campaign_deadline);
        return Err(ERROR_PLEDGE_DEADLINE_MISMATCH);
    }
    Ok(())
}

/// Sum the amounts of every pledge cell in `source` that belongs to this campaign.
///
/// A pledge cell belongs to this campaign when its lock is the pledge-lock contract and
/// the first 32 bytes of its lock args are this campaign's type script hash. That binding
/// is the one pledge-lock itself uses to decide where funds route, so it is the binding
/// worth accumulating against — the `campaign_id` field in pledge *data* is informational.
/// A pledge that belongs to this campaign but carries another deadline is rejected.
fn sum_campaign_pledges(
    source: Source,
    pledge_lock_code_hash: &[u8; 32],
    campaign_type_hash: &[u8; 32],
    campaign_deadline: u64,
    enforce_minimum: bool,
) -> Result<u64, i8> {
    let mut total: u64 = 0;

    for i in 0.. {
        let lock = match load_cell_lock(i, source) {
            Ok(l) => l,
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ERROR_LOAD_CELL),
        };

        if lock.code_hash().raw_data().as_ref() != &pledge_lock_code_hash[..] {
            continue;
        }

        let lock_args = lock.args().raw_data();
        if lock_args.len() < 32 || &lock_args[0..32] != &campaign_type_hash[..] {
            continue;
        }
        check_pledge_deadline(&lock_args, campaign_deadline)?;

        let data = match load_cell_data(i, source) {
            Ok(d) => d,
            Err(_) => return Err(ERROR_LOAD_DATA),
        };
        if data.len() < PLEDGE_DATA_SIZE {
            debug!("Pledge cell {} has malformed data ({} bytes)", i, data.len());
            return Err(ERROR_INVALID_PLEDGE_UPDATE);
        }

        let amount = u64::from_le_bytes(
            data[PLEDGE_AMOUNT_OFFSET..PLEDGE_DATA_SIZE].try_into().unwrap(),
        );

        // The amount is only a claim written in data. Count it only when the cell actually
        // holds it on top of its own storage cost, otherwise a cell holding a few hundred
        // CKB could claim the whole funding goal and push the campaign to Success. The
        // storage cost on top is what the pledge lock later returns to the backer.
        if enforce_minimum && amount < MIN_PLEDGE_AMOUNT {
            debug!("Pledge cell {} amount {} is below the minimum {}", i, amount, MIN_PLEDGE_AMOUNT);
            return Err(ERROR_PLEDGE_BELOW_MINIMUM);
        }

        let capacity = load_cell_capacity(i, source).map_err(|_| ERROR_LOAD_CELL)?;
        let occupied = load_cell_occupied_capacity(i, source).map_err(|_| ERROR_LOAD_CELL)?;
        let required = amount.checked_add(occupied).ok_or(ERROR_OVERFLOW)?;
        if capacity < required {
            debug!("Pledge cell {} claims {} but holds {} ({} occupied)", i, amount, capacity, occupied);
            return Err(ERROR_PLEDGE_UNDERFUNDED);
        }

        total = match total.checked_add(amount) {
            Some(v) => v,
            None => return Err(ERROR_OVERFLOW),
        };
    }

    Ok(total)
}

/// The campaign cell must never lose capacity across a state transition.
/// Without this, a permissionless finalizer could route the creator's cell capacity
/// to itself as change while still producing a structurally valid campaign cell.
fn validate_capacity_preserved() -> Result<(), i8> {
    let input_capacity = load_cell_capacity(0, Source::GroupInput)
        .map_err(|_| ERROR_LOAD_CELL)?;
    let output_capacity = load_cell_capacity(0, Source::GroupOutput)
        .map_err(|_| ERROR_LOAD_CELL)?;

    if output_capacity < input_capacity {
        debug!(
            "Campaign capacity decreased: {} -> {}",
            input_capacity, output_capacity
        );
        return Err(ERROR_CAPACITY_DECREASED);
    }

    Ok(())
}

/// Fields that may never change once a campaign exists.
fn validate_immutable_fields(
    old_data: &[u8],
    new_data: &[u8],
    old: &CampaignData,
    new: &CampaignData,
    error: i8,
) -> Result<(), i8> {
    if old.creator_lock_hash != new.creator_lock_hash {
        debug!("creator_lock_hash changed");
        return Err(error);
    }
    if old.funding_goal != new.funding_goal {
        debug!("funding_goal changed");
        return Err(error);
    }
    if old.deadline_block != new.deadline_block {
        debug!("deadline_block changed");
        return Err(error);
    }

    // Issue 6b fix: reserved bytes and the metadata tail must not change.
    // Comparing from byte 57 to the end covers both in one check; equal lengths are
    // required so the tail can't be truncated or extended.
    if old_data.len() != new_data.len() {
        debug!("campaign data length changed");
        return Err(error);
    }
    if old_data[57..] != new_data[57..] {
        debug!("reserved bytes or metadata changed");
        return Err(error);
    }

    Ok(())
}

/// Validate a pledge accumulator update (Active -> Active, total_pledged grows).
///
/// v1.2: every pledge transaction consumes the campaign cell and produces a new one with
/// `total_pledged` increased by exactly the amount of the pledge cells it creates. This is
/// what makes the terminal status verifiable on-chain at finalization time.
fn validate_pledge_update(
    old_data: &[u8],
    new_data: &[u8],
    old: &CampaignData,
    new: &CampaignData,
    pledge_lock_code_hash: &[u8; 32],
) -> Result<(), i8> {
    if old.status != CampaignStatus::Active {
        debug!("Pledge update: campaign is no longer Active");
        return Err(ERROR_INVALID_PLEDGE_UPDATE);
    }

    validate_immutable_fields(old_data, new_data, old, new, ERROR_INVALID_PLEDGE_UPDATE)?;

    let campaign_type_hash = load_script_hash().map_err(|_| ERROR_NO_SCRIPT)?;

    // Net pledge inflow: pledge cells created minus pledge cells consumed. A merge
    // transaction nets to zero and is rejected below — merges leave the total untouched
    // and have no reason to consume the campaign cell.
    // The minimum applies to new pledges only; consumed ones were checked when created
    let created = sum_campaign_pledges(Source::Output, pledge_lock_code_hash, &campaign_type_hash, old.deadline_block, true)?;
    let consumed = sum_campaign_pledges(Source::Input, pledge_lock_code_hash, &campaign_type_hash, old.deadline_block, false)?;

    if created <= consumed {
        debug!("Pledge update: no net pledge inflow ({} in, {} out)", created, consumed);
        return Err(ERROR_INVALID_PLEDGE_UPDATE);
    }
    let delta = created - consumed;

    let expected = match old.total_pledged.checked_add(delta) {
        Some(v) => v,
        None => return Err(ERROR_OVERFLOW),
    };
    if new.total_pledged != expected {
        debug!(
            "Pledge update: total_pledged {} != expected {}",
            new.total_pledged, expected
        );
        return Err(ERROR_INVALID_PLEDGE_UPDATE);
    }

    Ok(())
}

/// Validate a finalization (state transition from Active to Success/Failed)
fn validate_finalization(
    old_data: &[u8],
    new_data: &[u8],
    old: &CampaignData,
    new: &CampaignData,
) -> Result<(), i8> {
    // Issue 5 fix: enforce deadline via since field (defense in depth)
    // The campaign-lock script also enforces this, but type script check
    // ensures deadline is respected even if lock script changes.
    let since_raw = load_input_since(0, Source::GroupInput)
        .map_err(|_| ERROR_LOAD_SINCE)?;

    if since_raw == 0 {
        debug!("Finalization: since field required (deadline enforcement)");
        return Err(ERROR_INVALID_FINALIZATION);
    }

    let since = Since::new(since_raw);
    if !since.is_absolute() || !since.flags_is_valid() {
        debug!("Finalization: invalid since encoding");
        return Err(ERROR_INVALID_FINALIZATION);
    }

    match since.extract_lock_value() {
        Some(LockValue::BlockNumber(block)) => {
            if block < old.deadline_block {
                debug!("Finalization: since {} < deadline {}", block, old.deadline_block);
                return Err(ERROR_INVALID_FINALIZATION);
            }
        }
        _ => {
            debug!("Finalization: since must be absolute block number");
            return Err(ERROR_INVALID_FINALIZATION);
        }
    }

    // Old campaign must be Active
    if old.status != CampaignStatus::Active {
        debug!("Finalization: old campaign must be Active");
        return Err(ERROR_INVALID_FINALIZATION);
    }

    validate_immutable_fields(old_data, new_data, old, new, ERROR_INVALID_FINALIZATION)?;

    // The accumulated total carries over untouched — finalization records the outcome,
    // it does not restate the accounting.
    if old.total_pledged != new.total_pledged {
        debug!("Finalization: total_pledged changed");
        return Err(ERROR_INVALID_FINALIZATION);
    }

    // v1.2: the terminal status is verified against the on-chain accumulator rather than
    // trusted from whoever submits the finalization. This closes the v1.1 gap where an
    // honest finalizer was assumed.
    check_status_justified(new.status, old.total_pledged, old.funding_goal)?;

    Ok(())
}

/// The terminal status a finalization claims must match what the campaign actually raised.
/// Success requires the goal to be met; Failed requires it not to be. Active is not a
/// terminal status and can never be the target of a finalization.
fn check_status_justified(
    status: CampaignStatus,
    total_pledged: u64,
    funding_goal: u64,
) -> Result<(), i8> {
    match status {
        CampaignStatus::Success => {
            if total_pledged < funding_goal {
                debug!(
                    "Finalization: Success claimed but raised {} < goal {}",
                    total_pledged, funding_goal
                );
                return Err(ERROR_STATUS_NOT_JUSTIFIED);
            }
        }
        CampaignStatus::Failed => {
            if total_pledged >= funding_goal {
                debug!(
                    "Finalization: Failed claimed but raised {} >= goal {}",
                    total_pledged, funding_goal
                );
                return Err(ERROR_STATUS_NOT_JUSTIFIED);
            }
        }
        CampaignStatus::Active => {
            debug!("Finalization: new status must be Success or Failed");
            return Err(ERROR_INVALID_FINALIZATION);
        }
    }

    Ok(())
}

/// Destruction is only allowed once the grace period past the deadline has elapsed.
///
/// M-01: previously Failed campaigns could be destroyed immediately, which locked backers
/// out of refunds for up to the grace period — pledge-lock needs either the campaign
/// cell_dep (now gone) or the grace-period fail-safe. Gating both terminal statuses on the
/// grace period removes the lockout window entirely: by the time the campaign cell can
/// disappear, every backer can already refund without it.
fn validate_destruction_after_grace(campaign: &CampaignData) -> Result<(), i8> {
    let since_raw = load_input_since(0, Source::GroupInput)
        .map_err(|_| ERROR_LOAD_SINCE)?;

    if since_raw == 0 {
        debug!("Campaign destruction blocked — since field required");
        return Err(ERROR_DESTRUCTION_NOT_ALLOWED);
    }

    let since = Since::new(since_raw);
    if !since.is_absolute() || !since.flags_is_valid() {
        debug!("Campaign destruction blocked — invalid since encoding");
        return Err(ERROR_DESTRUCTION_NOT_ALLOWED);
    }

    let grace_deadline = campaign.deadline_block.saturating_add(GRACE_PERIOD_BLOCKS);
    match since.extract_lock_value() {
        Some(LockValue::BlockNumber(block)) if block >= grace_deadline => {
            debug!("Campaign destruction after grace period allowed");
            Ok(())
        }
        _ => {
            debug!("Campaign destruction blocked — grace period active");
            Err(ERROR_DESTRUCTION_NOT_ALLOWED)
        }
    }
}

/// A destroyed campaign cell's capacity belongs to the creator.
///
/// Destruction after the grace period needs no signature, so without this anyone could
/// destroy a finalized campaign and keep its capacity. No pledge-lock cell may be spent in
/// the same transaction: a pledge release also pays the creator, and one creator output
/// would then satisfy both scripts, letting the builder keep the difference.
fn validate_destruction_pays_creator(
    campaign: &CampaignData,
    pledge_lock_code_hash: &[u8; 32],
) -> Result<(), i8> {
    for i in 0.. {
        match load_cell_lock(i, Source::Input) {
            Ok(lock) => {
                if lock.code_hash().raw_data().as_ref() == &pledge_lock_code_hash[..] {
                    debug!("Campaign destruction blocked — pledge cell spent in the same transaction");
                    return Err(ERROR_DESTRUCTION_WITH_PLEDGES);
                }
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ERROR_LOAD_CELL),
        }
    }

    let capacity = load_cell_capacity(0, Source::GroupInput).map_err(|_| ERROR_LOAD_CELL)?;
    let mut paid: u64 = 0;
    for i in 0.. {
        match load_cell_lock_hash(i, Source::Output) {
            Ok(hash) => {
                if hash == campaign.creator_lock_hash {
                    let cap = load_cell_capacity(i, Source::Output).map_err(|_| ERROR_LOAD_CELL)?;
                    paid = paid.checked_add(cap).ok_or(ERROR_OVERFLOW)?;
                }
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ERROR_LOAD_CELL),
        }
    }

    if paid < capacity.saturating_sub(MAX_FEE) {
        debug!("Campaign destruction pays the creator {} of {}", paid, capacity);
        return Err(ERROR_CREATOR_NOT_PAID);
    }
    Ok(())
}

pub fn program_entry() -> i8 {
    debug!("Campaign Type Script running");

    // CAMP-01: Validate TypeID — first 32 bytes of args
    // On creation: verifies hash matches blake2b(first_input.out_point || output_index)
    // On update/burn: passes (TypeID rules allow transfer and burn)
    if let Err(_) = check_type_id(0, 32) {
        debug!("TypeID validation failed");
        return ERROR_INVALID_TYPE_ID;
    }

    // Load the script
    let script = match load_script() {
        Ok(script) => script,
        Err(_err) => {
            debug!("Failed to load script");
            return ERROR_NO_SCRIPT;
        }
    };

    let args = script.args().raw_data();
    if args.len() < CAMPAIGN_ARGS_SIZE {
        debug!("Campaign args too short: {} bytes", args.len());
        return ERROR_INVALID_ARGS;
    }
    let mut pledge_lock_code_hash = [0u8; 32];
    pledge_lock_code_hash.copy_from_slice(&args[32..64]);
    if pledge_lock_code_hash == [0u8; 32] {
        debug!("Campaign args: pledge_lock_code_hash must not be zero");
        return ERROR_INVALID_ARGS;
    }

    // Detect scenario by checking GroupInput and GroupOutput
    let input_count = match count_group_cells(Source::GroupInput) {
        Ok(c) => c,
        Err(code) => return code,
    };
    let output_count = match count_group_cells(Source::GroupOutput) {
        Ok(c) => c,
        Err(code) => return code,
    };

    // TypeID already makes this script unique to a single cell, but assert it explicitly
    // rather than silently validating index 0 and ignoring the rest.
    if input_count > 1 || output_count > 1 {
        debug!(
            "Multiple campaign cells in group ({} in, {} out)",
            input_count, output_count
        );
        return ERROR_MULTIPLE_CAMPAIGN_CELLS;
    }

    match (input_count > 0, output_count > 0) {
        // Creation: no input, has output
        (false, true) => {
            let data = match load_cell_data(0, Source::GroupOutput) {
                Ok(d) => d,
                Err(_) => return ERROR_LOAD_DATA,
            };
            match CampaignData::from_bytes(&data) {
                Ok(campaign) => {
                    debug!("Campaign creation validation");
                    if let Err(code) = campaign.validate_creation() {
                        return code;
                    }
                    debug!("Campaign creation passed");
                    0
                }
                Err(code) => code,
            }
        }

        // State transition: has input AND output.
        // A campaign that stays Active is a pledge accumulator update; anything else is a
        // finalization. Both must preserve the cell's capacity.
        (true, true) => {
            let old_data = match load_cell_data(0, Source::GroupInput) {
                Ok(d) => d,
                Err(_) => return ERROR_LOAD_DATA,
            };
            let new_data = match load_cell_data(0, Source::GroupOutput) {
                Ok(d) => d,
                Err(_) => return ERROR_LOAD_DATA,
            };
            let old = match CampaignData::from_bytes(&old_data) {
                Ok(c) => c,
                Err(code) => return code,
            };
            let new_campaign = match CampaignData::from_bytes(&new_data) {
                Ok(c) => c,
                Err(code) => return code,
            };

            if let Err(code) = validate_capacity_preserved() {
                return code;
            }

            let result = if new_campaign.status == CampaignStatus::Active {
                validate_pledge_update(
                    &old_data,
                    &new_data,
                    &old,
                    &new_campaign,
                    &pledge_lock_code_hash,
                )
            } else {
                validate_finalization(&old_data, &new_data, &old, &new_campaign)
            };

            if let Err(code) = result {
                return code;
            }
            debug!("Campaign state transition passed");
            0
        }

        // Destruction: has input, no output
        // Issue 1 fix: restrict destruction by campaign status
        (true, false) => {
            let data = match load_cell_data(0, Source::GroupInput) {
                Ok(d) => d,
                Err(_) => return ERROR_LOAD_DATA,
            };
            let campaign = match CampaignData::from_bytes(&data) {
                Ok(c) => c,
                Err(code) => return code,
            };

            match campaign.status {
                CampaignStatus::Active => {
                    // Active campaigns should not be destroyed
                    debug!("Active campaign destruction blocked");
                    ERROR_DESTRUCTION_NOT_ALLOWED
                }
                CampaignStatus::Success | CampaignStatus::Failed => {
                    // Both must hold. The payout check runs first only so each rejection
                    // can be observed on a devnet, where the grace period is unreachable.
                    match validate_destruction_pays_creator(&campaign, &pledge_lock_code_hash)
                        .and_then(|_| validate_destruction_after_grace(&campaign))
                    {
                        Ok(()) => 0,
                        Err(code) => code,
                    }
                }
            }
        }

        // No input, no output — shouldn't happen but allow
        (false, false) => {
            debug!("No campaign cells in transaction");
            0
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    fn campaign_bytes(goal: u64, deadline: u64, total: u64, status: u8) -> [u8; CampaignData::SIZE] {
        let mut bytes = [0u8; CampaignData::SIZE];
        bytes[0..32].copy_from_slice(&[7u8; 32]);
        bytes[32..40].copy_from_slice(&goal.to_le_bytes());
        bytes[40..48].copy_from_slice(&deadline.to_le_bytes());
        bytes[48..56].copy_from_slice(&total.to_le_bytes());
        bytes[56] = status;
        bytes
    }

    // === Data round-trip ===

    #[test]
    fn test_data_roundtrip_preserves_total_pledged() {
        let bytes = campaign_bytes(1000, 500, 750, 0);
        let parsed = CampaignData::from_bytes(&bytes).unwrap();
        assert_eq!(parsed.funding_goal, 1000);
        assert_eq!(parsed.deadline_block, 500);
        assert_eq!(parsed.total_pledged, 750);
        assert_eq!(parsed.status, CampaignStatus::Active);
        assert_eq!(parsed.to_bytes(), bytes);
    }

    #[test]
    fn test_new_campaign_must_start_empty() {
        let parsed = CampaignData::from_bytes(&campaign_bytes(1000, 500, 1, 0)).unwrap();
        assert!(parsed.validate_creation().is_err());
        let parsed = CampaignData::from_bytes(&campaign_bytes(1000, 500, 0, 0)).unwrap();
        assert!(parsed.validate_creation().is_ok());
    }

    // === Terminal status verification (v1.2 accumulator) ===

    #[test]
    fn test_success_requires_goal_met() {
        assert!(check_status_justified(CampaignStatus::Success, 1000, 1000).is_ok());
        assert!(check_status_justified(CampaignStatus::Success, 1001, 1000).is_ok());
        assert_eq!(
            check_status_justified(CampaignStatus::Success, 999, 1000),
            Err(ERROR_STATUS_NOT_JUSTIFIED)
        );
    }

    #[test]
    fn test_failed_requires_goal_missed() {
        assert!(check_status_justified(CampaignStatus::Failed, 999, 1000).is_ok());
        assert!(check_status_justified(CampaignStatus::Failed, 0, 1000).is_ok());
        assert_eq!(
            check_status_justified(CampaignStatus::Failed, 1000, 1000),
            Err(ERROR_STATUS_NOT_JUSTIFIED)
        );
    }

    #[test]
    fn test_finalizing_to_active_rejected() {
        assert_eq!(
            check_status_justified(CampaignStatus::Active, 1000, 1000),
            Err(ERROR_INVALID_FINALIZATION)
        );
    }

    // === Immutable fields ===

    #[test]
    fn test_immutable_fields_accept_status_and_total_change() {
        // validate_immutable_fields deliberately ignores status and total_pledged —
        // those are the two fields the transition paths are allowed to move.
        let old_bytes = campaign_bytes(1000, 500, 0, 0);
        let new_bytes = campaign_bytes(1000, 500, 900, 0);
        let old = CampaignData::from_bytes(&old_bytes).unwrap();
        let new = CampaignData::from_bytes(&new_bytes).unwrap();
        assert!(validate_immutable_fields(&old_bytes, &new_bytes, &old, &new, 99).is_ok());
    }

    #[test]
    fn test_immutable_fields_reject_goal_change() {
        let old_bytes = campaign_bytes(1000, 500, 0, 0);
        let new_bytes = campaign_bytes(10, 500, 0, 0);
        let old = CampaignData::from_bytes(&old_bytes).unwrap();
        let new = CampaignData::from_bytes(&new_bytes).unwrap();
        assert_eq!(
            validate_immutable_fields(&old_bytes, &new_bytes, &old, &new, 99),
            Err(99)
        );
    }

    #[test]
    fn test_immutable_fields_reject_deadline_change() {
        let old_bytes = campaign_bytes(1000, 500, 0, 0);
        let new_bytes = campaign_bytes(1000, 900, 0, 0);
        let old = CampaignData::from_bytes(&old_bytes).unwrap();
        let new = CampaignData::from_bytes(&new_bytes).unwrap();
        assert_eq!(
            validate_immutable_fields(&old_bytes, &new_bytes, &old, &new, 99),
            Err(99)
        );
    }

    #[test]
    fn test_immutable_fields_reject_reserved_byte_change() {
        let old_bytes = campaign_bytes(1000, 500, 0, 0);
        let mut new_bytes = campaign_bytes(1000, 500, 0, 0);
        new_bytes[60] = 1;
        let old = CampaignData::from_bytes(&old_bytes).unwrap();
        let new = CampaignData::from_bytes(&new_bytes).unwrap();
        assert_eq!(
            validate_immutable_fields(&old_bytes, &new_bytes, &old, &new, 99),
            Err(99)
        );
    }

    #[test]
    fn test_immutable_fields_reject_metadata_truncation() {
        let base = campaign_bytes(1000, 500, 0, 0);
        let mut old_bytes = base.to_vec();
        old_bytes.extend_from_slice(b"campaign title");
        let new_bytes = base.to_vec();
        let old = CampaignData::from_bytes(&old_bytes).unwrap();
        let new = CampaignData::from_bytes(&new_bytes).unwrap();
        assert_eq!(
            validate_immutable_fields(&old_bytes, &new_bytes, &old, &new, 99),
            Err(99)
        );
    }

    fn pledge_lock_args(deadline: u64) -> [u8; 72] {
        let mut args = [0u8; 72];
        args[32..40].copy_from_slice(&deadline.to_le_bytes());
        args
    }

    #[test]
    fn test_pledge_deadline_matching_campaign_accepted() {
        assert_eq!(check_pledge_deadline(&pledge_lock_args(500), 500), Ok(()));
    }

    #[test]
    fn test_pledge_deadline_zero_rejected() {
        assert_eq!(check_pledge_deadline(&pledge_lock_args(0), 500), Err(ERROR_PLEDGE_DEADLINE_MISMATCH));
    }

    #[test]
    fn test_pledge_deadline_later_than_campaign_rejected() {
        assert_eq!(check_pledge_deadline(&pledge_lock_args(501), 500), Err(ERROR_PLEDGE_DEADLINE_MISMATCH));
    }

    #[test]
    fn test_pledge_lock_args_without_deadline_rejected() {
        assert_eq!(check_pledge_deadline(&[0u8; 32], 500), Err(ERROR_PLEDGE_DEADLINE_MISMATCH));
    }
}
