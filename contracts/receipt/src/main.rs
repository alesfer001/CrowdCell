#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

use ckb_std::{
    ckb_constants::Source,
    debug,
    error::SysError,
    high_level::{
        load_cell_capacity, load_cell_data, load_cell_lock, load_cell_lock_hash, load_cell_type,
        load_cell_type_hash, load_input_since, load_script,
    },
    since::{LockValue, Since},
};

// === Error Codes ===
const ERROR_LOAD_DATA: i8 = 9;
const ERROR_INVALID_RECEIPT_DATA: i8 = 10;
const ERROR_RECEIPT_MODIFICATION_NOT_ALLOWED: i8 = 11;
const ERROR_ZERO_PLEDGE_AMOUNT: i8 = 12;
const ERROR_ZERO_BACKER_HASH: i8 = 13;
const ERROR_NO_MATCHING_PLEDGE: i8 = 14;
const ERROR_REFUND_OUTPUT_MISSING: i8 = 15;
const ERROR_LOAD_LOCK: i8 = 16;
const ERROR_LOAD_CAPACITY: i8 = 17;
const ERROR_LOAD_LOCK_HASH: i8 = 18;
const ERROR_LOAD_SCRIPT: i8 = 19;
const ERROR_INVALID_ARGS: i8 = 20;
const ERROR_AMOUNT_MISMATCH: i8 = 21;
const ERROR_BACKER_MISMATCH: i8 = 22;
// v1.2 Phase 8 (M-02)
const ERROR_NO_PLEDGE_CONSUMED: i8 = 23;
const ERROR_CAMPAIGN_MISMATCH: i8 = 24;
const ERROR_LOAD_SINCE: i8 = 25;
const ERROR_NOT_PLEDGE_LOCK: i8 = 26;

/// Same grace period as pledge-lock and the campaign contract (~180 days at 8s/block).
/// Past it a campaign cell may already be destroyed, so a receipt no longer needs one.
const GRACE_PERIOD_BLOCKS: u64 = 1_944_000;

/// Campaign status byte offset in campaign cell data, and the Active value
const CAMPAIGN_STATUS_OFFSET: usize = 56;
const CAMPAIGN_STATUS_ACTIVE: u8 = 0;

/// Maximum fee deducted during refund (1 CKB = 100M shannons)
const MAX_FEE: u64 = 100_000_000;

/// Size of pledge lock args (used to identify pledge cells in outputs)
const PLEDGE_LOCK_ARGS_SIZE: usize = 72;

/// Receipt data layout (80 bytes):
/// - pledge_amount: u64                   (bytes 0-7, LE)
/// - backer_lock_hash: [u8; 32]           (bytes 8-39)
/// - campaign_type_script_hash: [u8; 32]  (bytes 40-71) — same as the pledge lock args
/// - deadline_block: u64                  (bytes 72-79, LE) — same as the pledge lock args
///
/// The campaign fields let a receipt be destroyed once its campaign is settled. Without them
/// the only destruction path needs the pledge cell in the same transaction, and a pledge
/// released or refunded permissionlessly is gone before the backer can pair it.
/// Receipts from before v1.2 carry only the first 40 bytes.
struct ReceiptData {
    pledge_amount: u64,
    backer_lock_hash: [u8; 32],
    campaign: Option<ReceiptCampaign>,
}

struct ReceiptCampaign {
    type_script_hash: [u8; 32],
    deadline_block: u64,
}

impl ReceiptData {
    const LEGACY_SIZE: usize = 40;
    const SIZE: usize = 80;

    fn from_bytes(data: &[u8]) -> Result<Self, i8> {
        if data.len() < Self::LEGACY_SIZE {
            return Err(ERROR_INVALID_RECEIPT_DATA);
        }
        let pledge_amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
        let mut backer_lock_hash = [0u8; 32];
        backer_lock_hash.copy_from_slice(&data[8..40]);
        let campaign = if data.len() >= Self::SIZE {
            let mut type_script_hash = [0u8; 32];
            type_script_hash.copy_from_slice(&data[40..72]);
            Some(ReceiptCampaign {
                type_script_hash,
                deadline_block: u64::from_le_bytes(data[72..80].try_into().unwrap()),
            })
        } else {
            None
        };
        Ok(ReceiptData {
            pledge_amount,
            backer_lock_hash,
            campaign,
        })
    }
}

/// D-04: Receipt must be created in same transaction as a valid pledge cell
/// with matching pledge_amount and backer_lock_hash.
/// Receipt type script args contain the pledge contract CODE HASH (first 32 bytes).
/// We compare by code_hash (not full type script hash) to avoid circular dependency
/// between pledge and receipt args.
fn validate_receipt_creation() -> i8 {
    // Load receipt type script to get the pledge and pledge-lock code hashes from args
    let (pledge_code_hash, pledge_lock_code_hash) = match pledge_code_hashes_from_args() {
        Ok(h) => h,
        Err(code) => return code,
    };

    let receipt_data = match load_cell_data(0, Source::GroupOutput) {
        Ok(d) => d,
        Err(_) => return ERROR_LOAD_DATA,
    };
    let receipt = match ReceiptData::from_bytes(&receipt_data) {
        Ok(r) => r,
        Err(code) => return code,
    };

    // New receipts must carry the campaign fields, or they could never be reclaimed
    let campaign = match receipt.campaign.as_ref() {
        Some(c) => c,
        None => {
            debug!("Receipt creation: data must be {} bytes", ReceiptData::SIZE);
            return ERROR_INVALID_RECEIPT_DATA;
        }
    };

    // Validate pledge_amount > 0
    if receipt.pledge_amount == 0 {
        debug!("Receipt creation: pledge_amount must be > 0");
        return ERROR_ZERO_PLEDGE_AMOUNT;
    }

    // Validate backer_lock_hash is not all zeros
    if receipt.backer_lock_hash == [0u8; 32] {
        debug!("Receipt creation: backer_lock_hash must not be zero");
        return ERROR_ZERO_BACKER_HASH;
    }

    // Find the pledge cell in outputs by type script code_hash
    // Uses load_cell_type to get the full Script, then compares code_hash field
    let mut found_matching_pledge = false;
    for i in 0.. {
        match load_cell_type(i, Source::Output) {
            Ok(Some(type_script)) => {
                let code_hash = type_script.code_hash().raw_data();
                if code_hash.as_ref() == &pledge_code_hash {
                    // Found a pledge cell — read its data
                    let pledge_data = match load_cell_data(i, Source::Output) {
                        Ok(d) => d,
                        Err(_) => return ERROR_LOAD_DATA,
                    };
                    if pledge_data.len() < 72 {
                        continue; // Not a valid pledge cell
                    }
                    // Parse pledge data: campaign_id [0..32], backer_lock_hash [32..64], amount [64..72]
                    let pledge_amount = u64::from_le_bytes(pledge_data[64..72].try_into().unwrap());
                    let mut pledge_backer_hash = [0u8; 32];
                    pledge_backer_hash.copy_from_slice(&pledge_data[32..64]);

                    // Cross-check: receipt amount must match pledge amount
                    if pledge_amount != receipt.pledge_amount {
                        debug!(
                            "Receipt amount {} != pledge amount {}",
                            receipt.pledge_amount, pledge_amount
                        );
                        return ERROR_AMOUNT_MISMATCH;
                    }
                    // Cross-check: receipt backer must match pledge backer
                    if pledge_backer_hash != receipt.backer_lock_hash {
                        debug!("Receipt backer hash != pledge backer hash");
                        return ERROR_BACKER_MISMATCH;
                    }

                    // Cross-check: receipt campaign and deadline must match the pledge lock
                    // args, so a receipt cannot point at some other, already settled campaign
                    let lock = match load_cell_lock(i, Source::Output) {
                        Ok(lock) => lock,
                        Err(_) => return ERROR_LOAD_LOCK,
                    };
                    if lock.code_hash().raw_data().as_ref() != &pledge_lock_code_hash[..] {
                        debug!("Receipt creation: the pledge cell is not under the pledge lock");
                        return ERROR_NOT_PLEDGE_LOCK;
                    }
                    let lock_args = lock.args().raw_data();
                    if lock_args.len() < PLEDGE_LOCK_ARGS_SIZE
                        || lock_args[0..32] != campaign.type_script_hash
                        || lock_args[32..40] != campaign.deadline_block.to_le_bytes()
                    {
                        debug!("Receipt campaign fields do not match the pledge lock args");
                        return ERROR_CAMPAIGN_MISMATCH;
                    }

                    found_matching_pledge = true;
                    break;
                }
            }
            Ok(None) => continue,
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return ERROR_LOAD_DATA,
        }
    }

    if !found_matching_pledge {
        debug!("Receipt creation: no matching pledge cell found in outputs");
        return ERROR_NO_MATCHING_PLEDGE;
    }

    0
}

/// Read the pledge and pledge-lock code hashes out of this receipt's type script args.
///
/// Receipt type script args layout (64 bytes):
/// - pledge_code_hash:      [u8; 32] (bytes 0-31)  — the pledge type a receipt pairs with
/// - pledge_lock_code_hash: [u8; 32] (bytes 32-63) — the lock a real pledge cell sits under.
///   Anyone can put the pledge type on a cell under any lock, so the type alone does not
///   make a cell a pledge.
fn pledge_code_hashes_from_args() -> Result<([u8; 32], [u8; 32]), i8> {
    let script = load_script().map_err(|_| ERROR_LOAD_SCRIPT)?;
    let args = script.args().raw_data();
    if args.len() < 64 {
        debug!("Receipt args too short — need pledge and pledge-lock code hashes");
        return Err(ERROR_INVALID_ARGS);
    }
    let mut pledge_code_hash = [0u8; 32];
    pledge_code_hash.copy_from_slice(&args[0..32]);
    let mut pledge_lock_code_hash = [0u8; 32];
    pledge_lock_code_hash.copy_from_slice(&args[32..64]);
    Ok((pledge_code_hash, pledge_lock_code_hash))
}

/// M-02: a receipt only exists as the counterpart of a pledge cell, so destroying one
/// must consume a pledge cell in the same transaction. Without this an attacker willing
/// to burn capital could destroy a receipt while leaving the pledge intact, paying the
/// refund output from another input and leaving the pledge's accounting inconsistent.
///
/// The consumed pledge must be this receipt's own: pledge type, pledge lock, and lock args
/// naming the receipt's backer and campaign (second review, finding 5). The amount is not
/// compared, since a merged pledge holds several receipts' worth.
fn pledge_consumed_in_inputs(
    pledge_code_hash: &[u8; 32],
    pledge_lock_code_hash: &[u8; 32],
    receipt: &ReceiptData,
) -> Result<bool, i8> {
    for i in 0.. {
        match load_cell_type(i, Source::Input) {
            Ok(Some(type_script)) => {
                if type_script.code_hash().raw_data().as_ref() != &pledge_code_hash[..] {
                    continue;
                }
                let lock = load_cell_lock(i, Source::Input).map_err(|_| ERROR_LOAD_LOCK)?;
                if lock.code_hash().raw_data().as_ref() != &pledge_lock_code_hash[..] {
                    continue;
                }
                let lock_args = lock.args().raw_data();
                if lock_args.len() < PLEDGE_LOCK_ARGS_SIZE || lock_args[40..72] != receipt.backer_lock_hash {
                    continue;
                }
                // Receipts from before v1.2 carry no campaign fields: backer only
                if let Some(campaign) = receipt.campaign.as_ref() {
                    if lock_args[0..32] != campaign.type_script_hash
                        || lock_args[32..40] != campaign.deadline_block.to_le_bytes()
                    {
                        continue;
                    }
                }
                return Ok(true);
            }
            Ok(None) => continue,
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ERROR_LOAD_DATA),
        }
    }
    Ok(false)
}

/// Is the receipt's campaign settled? Either its finalized campaign cell is in cell deps,
/// or the grace period past the deadline has run out (the campaign cell may be gone by then).
fn campaign_settled(campaign: &ReceiptCampaign) -> Result<bool, i8> {
    for i in 0.. {
        match load_cell_type_hash(i, Source::CellDep) {
            Ok(Some(hash)) if hash == campaign.type_script_hash => {
                let data = load_cell_data(i, Source::CellDep).map_err(|_| ERROR_LOAD_DATA)?;
                if data.len() > CAMPAIGN_STATUS_OFFSET && data[CAMPAIGN_STATUS_OFFSET] != CAMPAIGN_STATUS_ACTIVE {
                    return Ok(true);
                }
            }
            Ok(_) => continue,
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ERROR_LOAD_DATA),
        }
    }

    let since_raw = load_input_since(0, Source::GroupInput).map_err(|_| ERROR_LOAD_SINCE)?;
    if since_raw == 0 {
        return Ok(false);
    }
    let since = Since::new(since_raw);
    if !since.is_absolute() || !since.flags_is_valid() {
        return Ok(false);
    }
    match since.extract_lock_value() {
        Some(LockValue::BlockNumber(block)) => {
            Ok(block >= campaign.deadline_block.saturating_add(GRACE_PERIOD_BLOCKS))
        }
        _ => Ok(false),
    }
}

/// Receipt destruction. Two ways to destroy a receipt:
///
/// 1. With its campaign settled (finalized campaign cell in cell deps, or past the grace
///    period). The pledge lock routes the funds on its own by then, so the receipt is only
///    the backer's record, and the backer (whose lock guards it) can reclaim its capacity.
/// 2. M-02: alongside a consumed pledge cell, with the refund going to the backer. This is
///    the only path for pre-v1.2 receipts and for a partial refund of a merged pledge.
fn validate_receipt_destruction() -> i8 {
    let receipt_data = match load_cell_data(0, Source::GroupInput) {
        Ok(d) => d,
        Err(_) => return ERROR_LOAD_DATA,
    };
    let receipt = match ReceiptData::from_bytes(&receipt_data) {
        Ok(r) => r,
        Err(code) => return code,
    };

    if let Some(campaign) = receipt.campaign.as_ref() {
        match campaign_settled(campaign) {
            Ok(true) => return 0,
            Ok(false) => {}
            Err(code) => return code,
        }
    }

    // M-02: the paired pledge cell must be consumed in the same transaction
    let (pledge_code_hash, pledge_lock_code_hash) = match pledge_code_hashes_from_args() {
        Ok(h) => h,
        Err(code) => return code,
    };
    match pledge_consumed_in_inputs(&pledge_code_hash, &pledge_lock_code_hash, &receipt) {
        Ok(true) => {}
        Ok(false) => {
            debug!("Receipt destruction: campaign not settled and no pledge cell consumed");
            return ERROR_NO_PLEDGE_CONSUMED;
        }
        Err(code) => return code,
    }

    // Verify that an output exists going to backer_lock_hash
    // with capacity >= pledge_amount - MAX_FEE
    let min_refund = receipt.pledge_amount.checked_sub(MAX_FEE).unwrap_or(0);

    let mut refund_found = false;
    for i in 0.. {
        match load_cell_lock_hash(i, Source::Output) {
            Ok(hash) => {
                if hash == receipt.backer_lock_hash {
                    let cap = match load_cell_capacity(i, Source::Output) {
                        Ok(c) => c,
                        Err(_) => return ERROR_LOAD_CAPACITY,
                    };
                    if cap >= min_refund {
                        refund_found = true;
                        break;
                    }
                }
            }
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return ERROR_LOAD_LOCK_HASH,
        }
    }

    if !refund_found {
        debug!("Receipt destruction: refund output missing or insufficient");
        return ERROR_REFUND_OUTPUT_MISSING;
    }

    0
}

pub fn program_entry() -> i8 {
    debug!("Receipt Type Script running");

    let has_input = match load_cell_data(0, Source::GroupInput) {
        Ok(_) => true,
        Err(SysError::IndexOutOfBound) => false,
        Err(_) => return ERROR_LOAD_DATA,
    };

    let has_output = match load_cell_data(0, Source::GroupOutput) {
        Ok(_) => true,
        Err(SysError::IndexOutOfBound) => false,
        Err(_) => return ERROR_LOAD_DATA,
    };

    match (has_input, has_output) {
        // Creation: validate receipt is created alongside a valid pledge
        (false, true) => validate_receipt_creation(),

        // Destruction: validate it's part of a valid refund
        (true, false) => validate_receipt_destruction(),

        // Modification: receipts are immutable (RCPT-02)
        (true, true) => {
            debug!("Receipt modification not allowed");
            ERROR_RECEIPT_MODIFICATION_NOT_ALLOWED
        }

        // No cells — shouldn't happen
        (false, false) => {
            debug!("No receipt cells in transaction");
            0
        }
    }
}
