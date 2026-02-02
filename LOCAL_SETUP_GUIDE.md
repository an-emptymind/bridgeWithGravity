# Gravity Bridge: Local Setup & Testing Guide

Quick guide for running a local Cosmos chain with Sepolia testnet bridge.

## Prerequisites

- Gravity binary (`gravity`) built and in PATH
- GBT (Gravity Bridge Tools) built: `orchestrator/target/release/gbt`
- Node.js installed for bridge scripts
- Sepolia testnet RPC access (e.g., Alchemy)
- Funded Sepolia wallet with ETH for gas

## Setup Steps

### 1. Start Local Cosmos Chain

```bash
gravity start \
  --home $HOME/.gravity-local \
  --rpc.laddr tcp://0.0.0.0:26657 \
  --grpc.address 0.0.0.0:9090 \
  --api.address tcp://0.0.0.0:1317 \
  --api.enable true
```

**What it does:**
- Starts the Gravity Cosmos chain node
- Exposes RPC endpoint on port 26657 for consensus queries
- Exposes gRPC on port 9090 for orchestrator communication
- Enables REST API on port 1317 for HTTP queries
- Uses `~/.gravity-local` as the chain data directory

### 2. Start Orchestrator

```bash
./target/release/gbt orchestrator \
  --cosmos-grpc http://localhost:9090 \
  --ethereum-rpc https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY \
  --ethereum-key "0xYOUR_PRIVATE_KEY" \
  --cosmos-phrase "your twelve or twenty-four word mnemonic phrase here" \
  --fees 0ugraviton \
  --gravity-contract-address 0x5eF175F8E1214c61D5914508703a00001279746e
```

**What it does:**
- Connects to local Cosmos chain via gRPC (port 9090)
- Connects to Sepolia testnet via Alchemy RPC
- Runs three services in one process:
  - **Oracle**: Watches Sepolia for `SendToCosmos` events, submits claims to Cosmos
  - **Signer**: Signs batch confirmations and validator set updates
  - **Relayer**: Submits signed batches to Sepolia (optional, can run separately)
- Uses provided private key for Ethereum transactions
- Uses mnemonic to derive Cosmos validator address

**Security Note:** Never commit private keys or mnemonics to version control.

## Bridge Testing

### Test 1: Sepolia → Cosmos (Deposit)

```bash
cd solidity
node scripts/ethToCosmos-sepolia.js --amount 0.15
```

**What it does:**
1. Approves Gravity contract to spend your ERC20 tokens
2. Calls `sendToCosmos()` on Gravity.sol to lock tokens
3. Emits `SendToCosmosEvent` on Sepolia
4. Orchestrator detects event and submits oracle claim to Cosmos
5. After 66% validator consensus, mints bridged tokens on Cosmos
6. Polls Cosmos REST API to confirm token arrival

**Expected Output:**
- Transaction hash on Sepolia
- Balance changes showing tokens locked on Sepolia
- New balance on Cosmos with `gravity0x...` denomination

**Typical Duration:** 1-3 minutes (depends on Sepolia block time ~12s)

### Test 2: Cosmos → Sepolia (Withdrawal)

```bash
cd solidity
node scripts/cosmosToEth-sepolia.js --amount 0.05
```

**What it does:**
1. Sends `MsgSendToEth` transaction on Cosmos chain
   - Transfers tokens from user to bridge module
   - Adds withdrawal to transaction pool
   - Pays bridge fee (to relayer) + chain fee
2. Requests batch creation for the token contract
3. Waits for orchestrator to sign the batch (~20s)
4. Relays signed batch to Sepolia using `gbt client spot-relay`
5. Gravity.sol executes batch and releases tokens to destination address
6. Polls Sepolia to confirm token arrival

**Expected Output:**
- Cosmos transaction showing tokens moved to bridge
- Batch creation confirmation
- Sepolia transaction hash for batch execution
- Balance changes on both chains

**Typical Duration:** 2-5 minutes (includes batch signing + Sepolia confirmation)

## Configuration Files

### Environment Variables (.env in solidity/)

```bash
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
SEPOLIA_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
GRAVITY_CONTRACT=0x5eF175F8E1214c61D5914508703a00001279746e
```

### Deployment Info (deployments/sepolia.json)

Scripts automatically load contract addresses from:
```
solidity/deployments/sepolia.json
```

## Useful Commands

### Query Cosmos Balance
```bash
curl http://localhost:1317/cosmos/bank/v1beta1/balances/gravity179y7cr3arkcp02zp4melft0sn5qn73x8kkwfk6
```

### Check Pending Batches
```bash
gravity query gravity pending-batch-request
```

### Check Orchestrator Status
Watch the orchestrator terminal output for:
- Oracle claims submitted
- Batches signed
- Relayer activity

## Troubleshooting

**Orchestrator not detecting events:**
- Ensure orchestrator is fully synced with both chains
- Check Sepolia RPC connection
- Verify contract address matches deployment

**Cosmos → Sepolia not completing:**
- Ensure batch has enough transactions (or force with `request-batch`)
- Wait full 20-30s for orchestrator to sign
- Check orchestrator has ETH for gas

**Tokens not arriving:**
- Verify transaction succeeded on source chain
- Check orchestrator logs for errors
- Sepolia testnet can be slow during high usage

## Architecture Overview

```
[Sepolia Testnet] ←→ [Orchestrator] ←→ [Local Cosmos Chain]
      ↓                    ↓                     ↓
  Gravity.sol          Oracle/Signer      Gravity Module
  (Lock/Unlock)        (Bridge Logic)     (Mint/Burn)
```

## Next Steps

- Deploy your own test ERC20 token on Sepolia
- Run multiple validators with orchestrators
- Implement automated relayer monitoring
- Add batch fee optimization logic
