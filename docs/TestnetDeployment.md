# Testnet Deployment Guide

Step-by-step guide to deploy CKB Kickstarter to the CKB testnet (Pudge).

## Prerequisites

- Contracts built (`scripts/build-contracts.sh`)
- Node.js 18+, npm installed
- All `npm install` completed in `off-chain/frontend`, `off-chain/indexer`, and `off-chain/transaction-builder`

## 1. Get a Funded Testnet Account

### The deployer key

The testnet deployer key lives in `off-chain/transaction-builder/.env` (gitignored) as
`DEPLOYER_PRIVATE_KEY`, with its address in a comment above it. `deploy-contracts.ts` reads it
from there on testnet, so reuse it for every deploy instead of making a new one. Only if that
file is gone, generate a new key, write it there the same way, and fund the address.

### Get testnet CKB from the faucet

1. Visit https://faucet.nervos.org/
2. Enter your testnet address (starts with `ckt1...`)
3. Request CKB — the five contracts take about **150,000 CKB** (144,576 bytes of binaries in
   October 2026, plus cell overhead and fees)

Each byte of a deployed binary requires 1 CKB of capacity.

## 2. Build Contracts

```bash
bash scripts/build-contracts.sh
```

The same RISC-V binaries work on all CKB networks. Output:
- `contracts/campaign/target/riscv64imac-unknown-none-elf/release/campaign-contract`
- `contracts/pledge/target/riscv64imac-unknown-none-elf/release/pledge`

## 3. Deploy Contracts

```bash
cd off-chain/transaction-builder

CKB_NETWORK=testnet npx ts-node deploy-contracts.ts
```

This will:
- Deploy both campaign and pledge contracts to testnet
- Wait for each transaction to confirm (~10 seconds per block)
- Save results to `deployment/deployed-contracts-testnet.json`
- Print the environment variables you need

Example output:
```
=== Deployment Complete ===
{
  "network": "testnet",
  "campaign": {
    "codeHash": "0xb71c1c...",
    "txHash": "0xabc123...",
    "index": 0
  },
  "pledge": {
    "codeHash": "0x423442...",
    "txHash": "0xdef456...",
    "index": 0
  }
}
```

## 4. Start the Indexer

```bash
cd off-chain/indexer

CKB_RPC_URL=https://testnet.ckbapp.dev/ \
CAMPAIGN_CODE_HASH=0xb71c1c... \
PLEDGE_CODE_HASH=0x423442... \
npm run dev
```

Or create an `off-chain/indexer/.env` file:

```env
CKB_RPC_URL=https://testnet.ckbapp.dev/
CAMPAIGN_CODE_HASH=0xb71c1c...
PLEDGE_CODE_HASH=0x423442...
PORT=3001
DB_PATH=./data/indexer-testnet.db
```

The indexer will poll the testnet every 10 seconds for new campaign/pledge cells.

## 5. Start the Frontend

```bash
cd off-chain/frontend

NEXT_PUBLIC_NETWORK=testnet \
NEXT_PUBLIC_CAMPAIGN_CODE_HASH=0xb71c1c... \
NEXT_PUBLIC_CAMPAIGN_TX_HASH=0xabc123... \
NEXT_PUBLIC_PLEDGE_CODE_HASH=0x423442... \
NEXT_PUBLIC_PLEDGE_TX_HASH=0xdef456... \
npm run dev
```

Or create an `off-chain/frontend/.env.local` file:

```env
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_CAMPAIGN_CODE_HASH=0xb71c1c...
NEXT_PUBLIC_CAMPAIGN_TX_HASH=0xabc123...
NEXT_PUBLIC_PLEDGE_CODE_HASH=0x423442...
NEXT_PUBLIC_PLEDGE_TX_HASH=0xdef456...
```

On testnet the frontend will:
- Show a blue "Testnet" badge instead of the orange "Devnet" badge
- Show "Connect Wallet" button instead of the devnet account switcher
- Use the CCC wallet connector for JoyID / MetaMask

## 6. Connect a Wallet

1. Open the frontend in your browser
2. Click **Connect Wallet**
3. Choose JoyID or MetaMask (via CCC connector)
4. Make sure your wallet is on the CKB testnet

## 7. Test the Full Lifecycle

1. **Create a campaign** — set a title, goal (>= 100 CKB), and deadline block
2. **Pledge CKB** — switch to a different wallet / account and pledge
3. **Wait for deadline** — or set a deadline close to the current block
4. **Finalize** — the creator finalizes the campaign
5. **Release / Refund** — depending on success or failure
6. **Destroy** — creator reclaims the campaign cell's CKB

## Differences from Devnet

| Aspect | Devnet | Testnet |
|--------|--------|---------|
| Block time | Instant | ~8-10 seconds |
| Wallet | Auto-connected test accounts | Real wallet (JoyID, MetaMask) |
| CKB | Pre-funded 42M CKB | Faucet (limited) |
| RPC | `http://127.0.0.1:8114` | `https://testnet.ckbapp.dev/` |
| System scripts | OFFCKB overrides | CCC built-in testnet scripts |

## Troubleshooting

### "Balance may be insufficient" during deployment
Request more CKB from the faucet. Each contract needs ~50,000 CKB.

### Transaction not confirming
Testnet blocks take ~8-10 seconds. The deploy script waits up to 120 seconds. If it times out, check the transaction on [CKB Testnet Explorer](https://pudge.explorer.nervos.org/).

### Indexer not finding cells
Make sure `CAMPAIGN_CODE_HASH` and `PLEDGE_CODE_HASH` match the deployment output. Code hashes are deterministic (same binary = same hash), but tx hashes are unique per deployment.

### Wallet won't connect
- Ensure your wallet supports CKB testnet
- JoyID: works out of the box on testnet
- MetaMask: requires the CKB Snap or PW-Core bridge

### "Cannot resolve creator lock script"
The indexer needs to re-index after the database migration. Delete the old `indexer.db` and restart, or wait for the next polling cycle.

## Environment Variable Reference

### Frontend (`NEXT_PUBLIC_*`)

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_NETWORK` | `devnet` | Network: `devnet`, `testnet`, `mainnet` |
| `NEXT_PUBLIC_CKB_RPC_URL` | Per network | CKB RPC endpoint |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Indexer API URL |
| `NEXT_PUBLIC_CAMPAIGN_CODE_HASH` | Devnet hash | Campaign contract code hash |
| `NEXT_PUBLIC_CAMPAIGN_TX_HASH` | Devnet hash | Campaign contract deployment tx |
| `NEXT_PUBLIC_PLEDGE_CODE_HASH` | Devnet hash | Pledge contract code hash |
| `NEXT_PUBLIC_PLEDGE_TX_HASH` | Devnet hash | Pledge contract deployment tx |

### Indexer

| Variable | Default | Description |
|----------|---------|-------------|
| `CKB_RPC_URL` | `http://127.0.0.1:8114` | CKB RPC endpoint |
| `PORT` | `3001` | API server port |
| `DB_PATH` | `./data/indexer.db` | SQLite database path |
| `POLL_INTERVAL` | `10000` | Background polling interval (ms) |
| `CAMPAIGN_CODE_HASH` | Devnet hash | Campaign contract code hash |
| `PLEDGE_CODE_HASH` | Devnet hash | Pledge contract code hash |

### Deploy Script

| Variable | Default | Description |
|----------|---------|-------------|
| `CKB_NETWORK` | `devnet` | Target network |
| `DEPLOYER_PRIVATE_KEY` | Devnet key | Private key for deployment |
| `CKB_RPC_URL` | Per network | CKB RPC endpoint |
