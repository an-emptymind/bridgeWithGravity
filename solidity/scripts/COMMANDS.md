# Bridge Testing Commands

## 1. Start Cosmos Chain

```bash
gravity start --home ~/.gravity-local --rpc.laddr tcp://0.0.0.0:26657 --grpc.address 0.0.0.0:9090 --api.address tcp://0.0.0.0:1317 --api.enable true
```
Starts local Cosmos chain with RPC, gRPC, and REST API enabled.

## 2. Register Orchestrator Keys (First Time Only)

```bash
cd orchestrator

# Register delegate keys
./target/release/gbt keys set-orchestrator-key \
  --phrase "rich purpose weapon detect unable correct few vast make hat squirrel off peanut table copy assault enable film bomb teach output fresh knife spring" \
  --cosmos-grpc http://localhost:9090 \
  --fees 0stake

# Register Ethereum key
./target/release/gbt keys set-ethereum-key \
  --phrase "rich purpose weapon detect unable correct few vast make hat squirrel off peanut table copy assault enable film bomb teach output fresh knife spring" \
  --ethereum-key "PVT_KEY" \
  --cosmos-grpc http://localhost:9090 \
  --fees 0stake
```
Links validator to orchestrator and Ethereum addresses.

## 3. Start Orchestrator

```bash
cd orchestrator

./target/release/gbt orchestrator \
  --cosmos-grpc http://localhost:9090 \
  --ethereum-rpc "https://rpc-url-ethereum-sepolia." \
  --ethereum-key "PVT_KEY" \
  --cosmos-phrase "rich purpose weapon detect unable correct few vast make hat squirrel off peanut table copy assault enable film bomb teach output fresh knife spring" \
  --fees 0ugraviton \
  --gravity-contract-address 0x5cD8a71b841429a3218c14da6F17F1f9ba46098e
```
Runs orchestrator to relay events between Cosmos and Ethereum (fast mode: ~2-3 min per direction).

## 4. Test Bridge

### Ethereum → Cosmos (Deposit)

```bash
cd solidity
node scripts/ethToCosmos-sepolia.js --amount 5
```
Sends tokens from Sepolia to Cosmos (~3 min).

### Cosmos → Ethereum (Withdrawal)

```bash
cd solidity
node scripts/cosmosToEth-sepolia.js --amount 2.5
```
Sends tokens from Cosmos to Sepolia (~3 min).

## Quick Status Checks

```bash
# Check Cosmos balance
gravity query bank balances gravity179y7cr3arkcp02zp4melft0sn5qn73x8kkwfk6 --node http://localhost:26657

# Check Sepolia balance
node scripts/checkBalance.js 0xEcA3700800d2Ac7Bc84a5d5B2E748282A38A3a0C

# Check Ethereum blocks
node scripts/checkEthBlocks.js
```
View balances and block status.

## Notes

- **Fast mode enabled**: Orchestrator waits 10 blocks (~2 min) instead of 96 blocks (~20 min)
- **Total bridge time**: ~3-4 minutes per direction
- **⚠️ Not safe for production** - only for testing
