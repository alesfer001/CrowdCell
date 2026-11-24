# Running a CrowdCell keeper

A keeper settles campaigns after their deadline. It finalizes them, then releases each pledge to the creator (funded) or refunds it to the backer (not funded). Every one of those transactions is permissionless: the on-chain scripts decide where the money goes, and the keeper only pays the fee to make it happen. A keeper key can't redirect funds.

CrowdCell's hosted indexer runs one. This lets anyone run another, on its own, without the API server.

## What it does

Every cycle (10 s by default):

1. Reads every campaign, pledge and receipt cell from the chain into its own SQLite file. It doesn't use CrowdCell's API.
2. Finalizes campaigns that are past their deadline and still active.
3. Releases pledges of funded campaigns and refunds pledges of failed ones.

When two keepers go for the same cell, one transaction lands and the other is rejected by the node. The loser logs the error and moves on next cycle.

## Setup

Needs Node 20+ and a CKB RPC endpoint (the public testnet one works).

```bash
git clone https://github.com/alesfer001/CrowdCell.git
cd CrowdCell/off-chain/transaction-builder && npm ci
cd ../indexer && npm ci
```

Create `off-chain/indexer/.env`:

```bash
CKB_NETWORK=testnet
CKB_RPC_URL=https://testnet.ckb.dev/rpc
BOT_PRIVATE_KEY=0x...   # a fresh key used only for this; it only pays fees
```

Fund the key's address with testnet CKB from the [faucet](https://faucet.nervos.org). The keeper prints its address on startup and warns when the balance drops below 50 CKB.

## Run

```bash
npm run build && npm run keeper   # built
npm run keeper:dev                # or straight from TypeScript
```

## Settings

| Variable | Default | |
|---|---|---|
| `BOT_PRIVATE_KEY` | required | Signs and pays fees |
| `CKB_NETWORK` | required | `testnet`, `mainnet` or `devnet` (picks the deployment file) |
| `CKB_RPC_URL` | `http://127.0.0.1:8114` | |
| `KEEPER_DB_PATH` | `./data/keeper.db` | Local index; safe to delete, it rebuilds from the chain |
| `POLL_INTERVAL` | `10000` | Milliseconds between cycles, at least 1000 |
| `LOW_BALANCE_THRESHOLD` | `50` | CKB; below this it logs a warning |

Contract code hashes and cell deps come from `deployment/deployed-contracts-<network>.json` in the repo, so after a redeploy a `git pull` and a restart are enough. The keeper logs which file it read on startup. To pin other values, set `CAMPAIGN_CODE_HASH`, `CAMPAIGN_TX_HASH`, `CAMPAIGN_LOCK_CODE_HASH`, `CAMPAIGN_LOCK_TX_HASH`, `PLEDGE_CODE_HASH`, `PLEDGE_TX_HASH`, `PLEDGE_LOCK_CODE_HASH`, `PLEDGE_LOCK_TX_HASH`, `RECEIPT_CODE_HASH`, `RECEIPT_TX_HASH` (each one overrides the file), or point `DEPLOYMENT_FILE` at another file.
