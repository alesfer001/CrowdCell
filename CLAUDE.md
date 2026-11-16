## Project

**CrowdCell**: all-or-nothing crowdfunding on Nervos CKB, live on testnet at crowdcell.vercel.app.

**Core value:** backers' funds go to the right place (the creator on success, the backer on failure) without anyone's cooperation. On-chain scripts enforce it, and anyone can trigger settlement.

### Constraints

- **Tech stack**: Rust + ckb-std for on-chain contracts, TypeScript + CCC SDK off-chain.
- **CKB cell model**: lock scripts control spending, type scripts validate state.
- **Transaction size**: CKB caps transaction size; pledge merging keeps settlement transactions small.
- **Clean deployments**: a contract change means a new deployment; old testnet cells are not migrated.
- **Budget**: free-tier infrastructure only (Render for the indexer, Vercel for the frontend).

## Repository Layout

- `contracts/` — on-chain scripts (Rust, ckb-std 1.0), built by `scripts/build-contracts.sh`
- `off-chain/transaction-builder/` — CCC transaction builder, deploy script and devnet test scripts
- `off-chain/indexer/` — Express + SQLite indexer with a REST API and the settlement keeper (`src/bot.ts`)
- `off-chain/frontend/` — Next.js 16 / React 19 / Tailwind 4 app with CCC wallet connector
- `deployment/deployed-contracts-{devnet,testnet}.json` — code hashes and tx hashes of the current deployments
- `e2e/` — browser test scenarios
- `docs/` — deployment guide and the v1.2 trust-boundary review

## Contracts

| Contract | Kind | Role |
|----------|------|------|
| `campaign` | type | Campaign lifecycle: creation (TypeID), pledge accumulation into `total_pledged`, finalization, destruction |
| `campaign-lock` | lock | Holds the campaign cell; spendable before the deadline only when the campaign is carried forward intact |
| `pledge` | type | Pledge cells: creation, merging, partial refund |
| `pledge-lock` | lock | Routes a pledge to the creator (Success) or the backer (Failed), callable by anyone; grace-period refund fallback |
| `receipt` | type | Backer's proof of pledge; destroyed when the pledge is refunded or the campaign settles |

### Data layouts (little-endian)

- **Campaign cell data** (65 bytes + optional metadata): `creator_lock_hash [32]`, `funding_goal u64`, `deadline_block u64`, `total_pledged u64`, `status u8` (0 Active, 1 Success, 2 Failed), `reserved [8]`. Title and description follow as length-prefixed strings.
- **Campaign type args** (64 bytes): TypeID `[32]`, then the pledge-lock code hash `[32]`.
- **Campaign-lock args** (8 bytes): `deadline_block u64`.
- **Pledge cell data** (72 bytes): `campaign_id [32]`, `backer_lock_hash [32]`, `amount u64`.
- **Pledge-lock args** (72 bytes): `campaign_type_script_hash [32]`, `deadline_block u64`, `backer_lock_hash [32]`.
- **Receipt cell data** (80 bytes): `pledge_amount u64`, `backer_lock_hash [32]`, `campaign_type_script_hash [32]`, `deadline_block u64`.

Minimum pledge is 100 CKB. The grace period (~180 days, 1,944,000 blocks at 8s/block) opens the refund fallback without a campaign cell_dep.

## Build & Run

- **Contracts**: `scripts/build-contracts.sh` (reproducible builds; contract `Cargo.lock` files are tracked so deployed code hashes reproduce)
- **Deploy**: `CKB_NETWORK=testnet npx ts-node deploy-contracts.ts` from `off-chain/transaction-builder/` (devnet is the default)
- **Indexer**: `npm run dev` (ts-node) or `npm run build && npm start` in `off-chain/indexer/`
- **Frontend**: `npm run dev` in `off-chain/frontend/`
- **Devnet tests**: the `test-*.ts` scripts in `off-chain/transaction-builder/` (e.g. `test-v1.2-exploits.ts`) run against an OffCKB devnet. They use OffCKB's publicly known devnet accounts.

## Configuration

- **Frontend** (`off-chain/frontend/.env.example`): `NEXT_PUBLIC_NETWORK` (devnet/testnet/mainnet), `NEXT_PUBLIC_API_URL`, optional `NEXT_PUBLIC_CKB_RPC_URL`, and `NEXT_PUBLIC_*_CODE_HASH` / `_TX_HASH` per contract
- **Indexer** (`off-chain/indexer/.env.example`): `CKB_RPC_URL` (default `http://127.0.0.1:8114`), `PORT` (3001), `DB_PATH` (`./data/indexer.db`), `POLL_INTERVAL` (10000 ms), contract code hashes
- Client-exposed variables use the `NEXT_PUBLIC_` prefix
- Current code hashes are in `deployment/deployed-contracts-testnet.json`; don't copy them into docs, they change on every redeploy

## Off-Chain Architecture

- **Write path**: frontend builds the transaction with CCC, the wallet signs, the node accepts it. Every pledge consumes and re-creates the campaign cell, so concurrent pledges race; the frontend retries on a spent-input error (`isInputAlreadySpentError` in `off-chain/frontend/src/app/campaigns/[id]/page.tsx`).
- **Read path**: the indexer polls the CKB RPC, parses cells (`parser.ts`) into SQLite (`database.ts`) and serves them over REST (`api.ts`); the frontend reads through `src/lib/api.ts`.
- **Keeper**: `off-chain/indexer/src/bot.ts` finalizes expired campaigns and releases or refunds pledges every polling cycle. Anyone can run one; settlement doesn't depend on it.
- **Effective status**: an Active campaign past its deadline shows off-chain as `expired_success` or `expired_failed` (by `total_pledged` vs. goal) until a finalize transaction lands; `success` and `failed` come from the chain.

## TypeScript Conventions

- Strict mode everywhere, target ES2020; Node module resolution for backend, bundler for frontend
- Files: PascalCase for components (`CampaignCard.tsx`), camelCase for utilities (`utils.ts`, `api.ts`)
- camelCase functions, UPPER_SNAKE_CASE module constants, PascalCase interfaces and enums
- Prefer `interface` over `type` for object shapes; `enum` for fixed sets; types live in each package's `types.ts`
- JSDoc on exported functions and types; named exports in utility files
- `"use client"` for interactive components; functional components with destructured props and a `<Name>Props` interface
- try/catch around async work; check response status before reading data; include context in thrown errors
- `bigint` for CKB amounts (shannons)
- Tailwind classes for styling, dark mode via `dark:`
- SQLite columns in snake_case (`creator_lock_hash`, `total_pledged`)

## Rust Conventions

- Each contract: `src/main.rs` (entry) and `src/lib.rs`, with:
  - `#![cfg_attr(not(any(feature = "library", test)), no_std)]`
  - `#![cfg_attr(not(test), no_main)]`
  - `ckb_std::entry!(program_entry)` and `ckb_std::default_alloc!(16384, 1258306, 64)`
- Enums for serialized values use `#[repr(u8)]` and derive `Debug, Clone, Copy, PartialEq, Eq`
- Fixed-size structs have a `SIZE` constant, `from_bytes() -> Result<Self, i8>` and `to_bytes()`
- Document byte layouts in `///` comments above the struct or constant
- Errors are `i8` codes as module constants with an `ERROR_` prefix; functions return `Result<T, i8>`
- Validation functions are named `validate_*()` and return `Result<(), i8>`
- `debug!()` with context for logging

### Contract Change Checklist

Check each item before a contract fix or change goes out for review. These come from review findings on the v1.2 contracts.

- **Every group input, not index 0**: a lock/type check that loads `Source::GroupInput` at index 0 only lets extra cells in the same group skip the check. Loop over all of them.
- **Args length matches the consumer**: if another script parses these args, require its full size (e.g. pledge-lock args are `PLEDGE_LOCK_ARGS_SIZE` = 72), not just the bytes this script reads.
- **Pair cells 1:1**: "a matching cell exists in the inputs" is not enough when several cells can share one counterpart. Pair each cell with its own, and check what happens to it (refunded vs. merged or carried forward).
- **Match every code_hash/hash_type variant**: counting cells by this script's exact `code_hash` + `hash_type` misses `data1`/`data2` references and older deployments of the same contract.
- **Mainnet guards**: testnet-only fallbacks (keys, defaults) must refuse to run on mainnet.
- **A test per attack**: every fix comes with a test that tries the attack it closes.

## Public Repository

This repo is public. Only commit what can be read by anyone: no keys, `.env` files, wallet files, personal notes, outreach or grant strategy, or absolute local paths. `docs/` and `deployment/` are gitignored by default; files there are added deliberately.
