# Quick Local Guide - Gravity Bridge Testing

This guide provides step-by-step instructions to set up a local Gravity Bridge testnet and test token bridging between Cosmos and Ethereum.

## Prerequisites

- Go 1.21+
- Rust 1.70+
- Node.js 18+
- Git

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Terminal 1    │     │   Terminal 2    │     │   Terminal 3    │
│                 │     │                 │     │                 │
│  Cosmos Chain   │◄───►│   EVM Chain     │◄───►│  Orchestrator   │
│   (Gravity)     │     │   (Hardhat)     │     │  (Oracle+Relay) │
│                 │     │                 │     │                 │
│  Port: 26657    │     │  Port: 8545     │     │  Connects to    │
│  gRPC: 9090     │     │                 │     │  both chains    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

---

## Initial Setup (One-time)

### 1. Build Gravity Chain Binary

```bash
cd module
make install
```

This compiles the Gravity Cosmos SDK chain and installs the `gravity` binary.

### 2. Build Orchestrator Binary

```bash
cd orchestrator
cargo build --release
```

This compiles the `gbt` (Gravity Bridge Tools) binary which includes the orchestrator, relayer, and CLI tools.

### 3. Install Solidity Dependencies

```bash
cd solidity
npm install
```

This installs Hardhat and other dependencies needed for the local EVM chain.

---

## Chain Initialization (One-time)

### 4. Initialize Cosmos Chain

```bash
# Set home directory
export GRAVITY_HOME=$HOME/.gravity-local

# Initialize the chain
gravity init validator1 --chain-id gravity-local-1 --home $GRAVITY_HOME

# Create validator key
gravity keys add validator1 --keyring-backend test --home $GRAVITY_HOME

# Create orchestrator key
gravity keys add orchestrator1 --keyring-backend test --home $GRAVITY_HOME

# Save the mnemonics! You'll need them for the orchestrator.
```

### 5. Generate Ethereum Key

```bash
# Generate or use an existing Ethereum private key
# For testing, you can use this pre-funded Hardhat account:
ETH_PRIVATE_KEY="0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122"
ETH_ADDRESS="0xc783df8a850f42e7F7e57013759C285caa701eB6"
```

### 6. Configure Genesis

```bash
# Get validator address
VALIDATOR_ADDR=$(gravity keys show validator1 -a --keyring-backend test --home $GRAVITY_HOME)
ORCHESTRATOR_ADDR=$(gravity keys show orchestrator1 -a --keyring-backend test --home $GRAVITY_HOME)

# Add genesis account with tokens
gravity genesis add-genesis-account $VALIDATOR_ADDR 1000000000000ugraviton --home $GRAVITY_HOME

# Create gentx with delegate keys (links validator, orchestrator, and ETH address)
gravity genesis gentx validator1 500000000ugraviton \
  --chain-id gravity-local-1 \
  --keyring-backend test \
  --home $GRAVITY_HOME \
  --eth-address $ETH_ADDRESS \
  --orchestrator-address $ORCHESTRATOR_ADDR

# Collect gentx
gravity genesis collect-gentxs --home $GRAVITY_HOME

# Fix bech32ibc config (change nativeHRP to "gravity")
cd $GRAVITY_HOME/config
jq '.app_state.bech32ibc.nativeHRP = "gravity"' genesis.json > genesis_temp.json && mv genesis_temp.json genesis.json

# Set minimum gas price
sed -i '' 's/minimum-gas-prices = ""/minimum-gas-prices = "0ugraviton"/' app.toml
```

---

## Starting the Nodes

### Terminal 1: Cosmos Chain

```bash
gravity start \
  --home $HOME/.gravity-local \
  --rpc.laddr tcp://0.0.0.0:26657 \
  --grpc.address 0.0.0.0:9090 \
  --api.address tcp://0.0.0.0:1317 \
  --api.enable true
```

**What it does:** Starts the Gravity Cosmos chain with:
- RPC endpoint on port 26657 (for CLI queries)
- gRPC endpoint on port 9090 (for orchestrator)
- REST API on port 1317 (for contract deployer)

Wait until you see blocks being produced before continuing.

---

### Terminal 2: EVM Chain (Hardhat)

```bash
cd solidity
npx hardhat node --hostname 0.0.0.0
```

**What it does:** Starts a local Ethereum node with:
- JSON-RPC endpoint on port 8545
- Pre-funded test accounts
- Post-merge hardfork support (for "finalized" block tag)
- Auto-mining every 3-6 seconds

---

### Terminal 2 (continued): Deploy Contracts

In a new terminal or after Hardhat starts, deploy the Gravity contracts:

```bash
cd solidity
npx ts-node contract-deployer.ts \
  --eth-node="http://0.0.0.0:8545" \
  --cosmos-node="http://localhost" \
  --eth-privkey="0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122" \
  --contract="artifacts/contracts/Gravity.sol/Gravity.json" \
  --contractERC721="artifacts/contracts/GravityERC721.sol/GravityERC721.json" \
  --test-mode="true" \
  --contractERC20A="artifacts/contracts/TestERC20A.sol/TestERC20A.json" \
  --contractERC20B="artifacts/contracts/TestERC20B.sol/TestERC20B.json" \
  --contractERC20C="artifacts/contracts/TestERC20C.sol/TestERC20C.json"
```

**What it does:** Deploys to Hardhat:
- Gravity.sol - Main bridge contract
- GravityERC721.sol - NFT bridge contract
- TestERC20A/B/C - Test tokens for bridging

**Save the output addresses!** You'll need the Gravity contract address for the orchestrator.

Example output:
```
Gravity deployed at Address -  0xf4e77E5Da47AC3125140c470c71cBca77B5c638c
ERC20 deployed at Address -  0x7c2C195CD6D34B8F845992d380aADB2730bB9C6F
```

---

### Terminal 3: Orchestrator

```bash
cd orchestrator
./target/release/gbt orchestrator \
  --cosmos-grpc http://localhost:9090 \
  --ethereum-rpc http://127.0.0.1:8545 \
  --ethereum-key "0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122" \
  --cosmos-phrase "YOUR_ORCHESTRATOR_MNEMONIC_HERE" \
  --fees 0ugraviton \
  --gravity-contract-address 0xf4e77E5Da47AC3125140c470c71cBca77B5c638c
```

**What it does:** Runs the orchestrator which:
- **Oracle**: Watches Ethereum for bridge events and reports them to Cosmos
- **Signer**: Signs validator set updates and transaction batches
- **Relayer**: (Optional) Relays batches from Cosmos to Ethereum

Replace `YOUR_ORCHESTRATOR_MNEMONIC_HERE` with the mnemonic from step 4.

---

## Testing the Bridge

### Check Balances

```bash
# Check Cosmos balance
gravity query bank balances $(gravity keys show validator1 -a --keyring-backend test --home $HOME/.gravity-local) --home $HOME/.gravity-local
```

### Ethereum → Cosmos Transfer

```bash
cd solidity
node scripts/ethToCosmos.js --amount 5000
```

**What it does:**
1. Approves Gravity contract to spend ERC20 tokens
2. Calls `sendToCosmos()` to lock tokens in Gravity contract
3. Waits for orchestrator to observe and relay the event
4. Tokens are minted on Cosmos as `gravity0x<token_address>`

**Options:**
- `--amount <wei>` - Amount to transfer (default: 5000)
- `--destination <cosmos_addr>` - Cosmos destination address
- `--token <erc20_addr>` - ERC20 token contract address

---

### Cosmos → Ethereum Transfer

```bash
cd solidity
node scripts/cosmosToEth.js --amount 2000
```

**What it does:**
1. Sends `send-to-eth` transaction to add tokens to bridge pool
2. Requests batch creation
3. Waits for orchestrator to sign the batch
4. Relays the batch to Ethereum
5. Tokens are released from Gravity contract on Ethereum

**Options:**
- `--amount <wei>` - Amount to transfer (default: 2000)
- `--destination <eth_addr>` - Ethereum destination address
- `--token <erc20_addr>` - ERC20 token contract address
- `--bridge-fee <wei>` - Fee paid to relayer (default: 1)
- `--chain-fee <wei>` - Fee paid to validators (default: 1)

---

### Manual Commands

#### Send tokens from Cosmos to Ethereum manually:

```bash
# Add to bridge pool
gravity tx gravity send-to-eth \
  0xYOUR_ETH_ADDRESS \
  1000gravity0x7c2C195CD6D34B8F845992d380aADB2730bB9C6F \
  1gravity0x7c2C195CD6D34B8F845992d380aADB2730bB9C6F \
  1gravity0x7c2C195CD6D34B8F845992d380aADB2730bB9C6F \
  --from validator1 \
  --home $HOME/.gravity-local \
  --chain-id gravity-local-1 \
  --keyring-backend test \
  --fees 0ugraviton -y

# Request batch
gravity tx gravity request-batch \
  0x7c2C195CD6D34B8F845992d380aADB2730bB9C6F \
  --from validator1 \
  --home $HOME/.gravity-local \
  --chain-id gravity-local-1 \
  --keyring-backend test \
  --fees 0ugraviton -y

# Relay batch manually
cd orchestrator
./target/release/gbt client spot-relay \
  --ethereum-key "0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122" \
  --ethereum-rpc http://127.0.0.1:8545 \
  --cosmos-grpc http://localhost:9090 \
  --gravity-contract-address 0xf4e77E5Da47AC3125140c470c71cBca77B5c638c \
  --token 0x7c2C195CD6D34B8F845992d380aADB2730bB9C6F
```

---

## Troubleshooting

### "Gravity Delegate keys are not set"
The gentx wasn't created with `--eth-address` and `--orchestrator-address` flags. Re-run genesis setup.

### "finalized block" error in orchestrator
This repo includes a patch that converts this to a warning for local development. Make sure you're using the modified `main_loop.rs`.

### "Failed to get sigs for batch"
The orchestrator hasn't signed the batch yet. Wait 10-15 seconds for the signing to complete, then retry the relay.

### Hardhat "Invalid value for hardfork"
Make sure you're using Hardhat v2.19.0+ which supports the "merge" hardfork.

---

## Key Addresses (Default Test Setup)

| Component | Address |
|-----------|---------|
| Gravity Contract | `0xf4e77E5Da47AC3125140c470c71cBca77B5c638c` |
| TestERC20A | `0x7c2C195CD6D34B8F845992d380aADB2730bB9C6F` |
| Ethereum Account | `0xc783df8a850f42e7F7e57013759C285caa701eB6` |
| Cosmos Validator | `gravity16hjzgzvqzysltxe4599qsgpwj3gpmu384ws95g` |

---

## File Structure

```
Gravity-Bridge/
├── module/                 # Cosmos SDK chain code
├── orchestrator/           # Rust orchestrator/relayer
│   └── target/release/gbt  # Compiled binary
├── solidity/               # Ethereum contracts
│   ├── contracts/          # Solidity source files
│   ├── scripts/
│   │   ├── ethToCosmos.js  # ETH→Cosmos bridge script
│   │   └── cosmosToEth.js  # Cosmos→ETH bridge script
│   └── hardhat.config.ts   # Hardhat configuration
└── QUICK_LOCAL_GUIDE.md    # This file
```
