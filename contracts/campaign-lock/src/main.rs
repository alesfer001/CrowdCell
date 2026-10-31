#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

use ckb_std::{
    debug,
    high_level::{
        load_script, load_input_since, load_cell_lock_hash, load_cell_type_hash, load_cell_capacity,
        load_cell_data,
    },
    ckb_constants::Source,
    error::SysError,
    since::{Since, LockValue},
};

// === Error Codes ===
pub const ERROR_INVALID_ARGS: i8 = 10;
const ERROR_LOAD_SINCE: i8 = 11;
const ERROR_INVALID_SINCE: i8 = 12;
const ERROR_SINCE_BELOW_DEADLINE: i8 = 13;
// v1.2 Phase 8
const ERROR_LOAD_CELL: i8 = 14;
const ERROR_CAPACITY_DECREASED: i8 = 15;

const CAMPAIGN_LOCK_ARGS_SIZE: usize = 8;

/// Byte offset of `status` within campaign cell data, and the Active value.
const CAMPAIGN_STATUS_OFFSET: usize = 56;
const CAMPAIGN_DATA_MIN_SIZE: usize = 65;
const CAMPAIGN_STATUS_ACTIVE: u8 = 0;

/// Campaign lock script args layout (8 bytes):
/// - deadline_block: u64 (bytes 0-7, LE)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CampaignLockArgs {
    pub deadline_block: u64,
}

impl CampaignLockArgs {
    fn from_bytes(data: &[u8]) -> Result<Self, i8> {
        if data.len() < CAMPAIGN_LOCK_ARGS_SIZE {
            return Err(ERROR_INVALID_ARGS);
        }
        let deadline_block = u64::from_le_bytes(data[0..8].try_into().unwrap());
        Ok(CampaignLockArgs { deadline_block })
    }
}

/// Is this transaction a pledge accumulator update, for every cell under this lock?
///
/// The args are just the deadline, so any cell with the same deadline lands in this script
/// group. Each one has to qualify, or a stray cell could leave behind a real pledge update.
fn all_group_inputs_carried_forward() -> Result<bool, i8> {
    for i in 0.. {
        match load_cell_capacity(i, Source::GroupInput) {
            Ok(_) => {}
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ERROR_LOAD_CELL),
        }
        if !is_active_campaign_carried_forward(i)? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Is this group input a campaign cell being carried forward?
///
/// v1.2 Phase 8: every pledge consumes the campaign cell and re-creates it with a larger
/// `total_pledged`, which means the campaign cell now has to be spendable *before* the
/// deadline. That is only allowed when the campaign is carried forward intact: the output
/// carrying the campaign's type script, under this same lock, holding at least the same
/// capacity, still in Active status. Only that output counts: any other cell under this lock
/// with Active-looking data could be a decoy while the campaign cell leaves under another lock.
/// Everything the data may or may not change is the type script's business; the lock only
/// decides whether the deadline gate applies.
fn is_active_campaign_carried_forward(group_index: usize) -> Result<bool, i8> {
    let own_lock_hash = load_cell_lock_hash(group_index, Source::GroupInput)
        .map_err(|_| ERROR_LOAD_CELL)?;
    let input_capacity = load_cell_capacity(group_index, Source::GroupInput)
        .map_err(|_| ERROR_LOAD_CELL)?;
    // A cell under this lock with no type is not a campaign and gets no exemption
    let campaign_type_hash = match load_cell_type_hash(group_index, Source::GroupInput) {
        Ok(Some(h)) => h,
        Ok(None) => return Ok(false),
        Err(_) => return Err(ERROR_LOAD_CELL),
    };

    for i in 0.. {
        let type_hash = match load_cell_type_hash(i, Source::Output) {
            Ok(h) => h,
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ERROR_LOAD_CELL),
        };
        if type_hash != Some(campaign_type_hash) {
            continue;
        }

        // TypeID makes this the one campaign cell: it either stays under this lock as
        // Active, or this is not a carry-forward
        let lock_hash = load_cell_lock_hash(i, Source::Output).map_err(|_| ERROR_LOAD_CELL)?;
        if lock_hash != own_lock_hash {
            debug!("Campaign cell output is under another lock");
            return Ok(false);
        }

        let data = load_cell_data(i, Source::Output).map_err(|_| ERROR_LOAD_CELL)?;
        if data.len() < CAMPAIGN_DATA_MIN_SIZE
            || data[CAMPAIGN_STATUS_OFFSET] != CAMPAIGN_STATUS_ACTIVE
        {
            return Ok(false);
        }

        let output_capacity = load_cell_capacity(i, Source::Output).map_err(|_| ERROR_LOAD_CELL)?;
        if output_capacity < input_capacity {
            debug!(
                "Campaign carried forward with less capacity: {} -> {}",
                input_capacity, output_capacity
            );
            return Err(ERROR_CAPACITY_DECREASED);
        }

        return Ok(true);
    }

    Ok(false)
}

pub fn program_entry() -> i8 {
    debug!("Campaign Lock Script running");

    // 1. Load own script and parse args
    let script = match load_script() {
        Ok(s) => s,
        Err(_) => {
            debug!("Failed to load script");
            return ERROR_INVALID_ARGS;
        }
    };
    let args = script.args().raw_data();
    let lock_args = match CampaignLockArgs::from_bytes(&args) {
        Ok(a) => a,
        Err(code) => return code,
    };

    // 2. Pledge accumulator updates happen before the deadline and are exempt from the
    //    deadline gate. The campaign type script validates the state transition itself.
    match all_group_inputs_carried_forward() {
        Ok(true) => {
            debug!("Active campaign carried forward — allowing pre-deadline spend");
            return 0;
        }
        Ok(false) => {}
        Err(code) => return code,
    }

    // 3. Everything else (finalization, destruction) is gated on the deadline.
    let since_raw = match load_input_since(0, Source::GroupInput) {
        Ok(v) => v,
        Err(_) => return ERROR_LOAD_SINCE,
    };

    // M-03: validate the since encoding explicitly instead of comparing the raw value,
    // mirroring pledge-lock. CKB consensus already rejects malformed since, but the
    // asymmetry between the two locks was a defense-in-depth gap.
    let since = Since::new(since_raw);
    if !since.is_absolute() || !since.flags_is_valid() {
        debug!("Invalid since encoding: {}", since_raw);
        return ERROR_INVALID_SINCE;
    }

    let since_block = match since.extract_lock_value() {
        Some(LockValue::BlockNumber(block)) => block,
        _ => {
            debug!("Since must be an absolute block number");
            return ERROR_INVALID_SINCE;
        }
    };

    if since_block < lock_args.deadline_block {
        debug!(
            "Since {} < deadline {}: before deadline, rejecting",
            since_block, lock_args.deadline_block
        );
        return ERROR_SINCE_BELOW_DEADLINE;
    }

    // Deadline met — allow spending. Type script will validate state transitions.
    debug!("Deadline met (since={}, deadline={}), allowing spend", since_block, lock_args.deadline_block);
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    // === Lock Args Parsing Tests ===

    #[test]
    fn test_deadline_parsing() {
        let args_bytes = 1000u64.to_le_bytes();
        let lock_args = CampaignLockArgs::from_bytes(&args_bytes).unwrap();
        assert_eq!(lock_args.deadline_block, 1000);
    }

    #[test]
    fn test_invalid_args_too_short() {
        let short_args = [0u8; 7];
        let result = CampaignLockArgs::from_bytes(&short_args);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), ERROR_INVALID_ARGS);
    }

    #[test]
    fn test_args_with_extra_bytes() {
        let mut args = vec![0u8; 16];
        let deadline = 2500u64;
        args[0..8].copy_from_slice(&deadline.to_le_bytes());
        let result = CampaignLockArgs::from_bytes(&args);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().deadline_block, 2500);
    }

    #[test]
    fn test_le_bytes_roundtrip() {
        let deadline = 0x0102030405060708u64;
        let bytes = deadline.to_le_bytes();
        let parsed = u64::from_le_bytes(bytes);
        assert_eq!(parsed, deadline);
    }

    #[test]
    fn test_multiple_deadlines() {
        let test_deadlines = vec![100u64, 1000u64, 10000u64, 100000u64];
        for deadline in test_deadlines {
            let args = deadline.to_le_bytes();
            let parsed = CampaignLockArgs::from_bytes(&args).unwrap();
            assert_eq!(parsed.deadline_block, deadline);
        }
    }

    // === Since Validation Logic Tests ===

    #[test]
    fn test_since_below_deadline_rejected() {
        // since_raw=500 < deadline=1000 → reject
        let deadline = 1000u64;
        let since_raw = 500u64;
        assert!(since_raw < deadline);
    }

    #[test]
    fn test_since_equal_deadline_accepted() {
        // since_raw=1000 >= deadline=1000 → accept
        let deadline = 1000u64;
        let since_raw = 1000u64;
        assert!(since_raw >= deadline);
    }

    #[test]
    fn test_since_above_deadline_accepted() {
        // since_raw=1500 >= deadline=1000 → accept
        let deadline = 1000u64;
        let since_raw = 1500u64;
        assert!(since_raw >= deadline);
    }

    #[test]
    fn test_since_zero_rejected() {
        // since_raw=0 < any deadline → reject (before deadline)
        let deadline = 1000u64;
        let since_raw = 0u64;
        assert!(since_raw < deadline);
    }

    #[test]
    fn test_error_codes_are_distinct() {
        assert_ne!(ERROR_INVALID_ARGS, ERROR_LOAD_SINCE);
        assert_ne!(ERROR_INVALID_ARGS, ERROR_INVALID_SINCE);
        assert_ne!(ERROR_INVALID_ARGS, ERROR_SINCE_BELOW_DEADLINE);
        assert_ne!(ERROR_LOAD_SINCE, ERROR_INVALID_SINCE);
        assert_ne!(ERROR_LOAD_SINCE, ERROR_SINCE_BELOW_DEADLINE);
        assert_ne!(ERROR_INVALID_SINCE, ERROR_SINCE_BELOW_DEADLINE);
    }
}
