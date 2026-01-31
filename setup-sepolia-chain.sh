#!/bin/bash

# ============================================
# Gravity Bridge - Sepolia Testnet Chain Setup
# ============================================

set -e

# Configuration
CHAIN_ID="gravity-sepolia-1"
GRAVITY_HOME="$HOME/.gravity-local"
MONIKER="validator1"

# Your Sepolia ETH address (from your funded wallet)
ETH_ADDRESS="0xEcA3700800d2Ac7Bc84a5d5B2E748282A38A3a0C"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║     SETTING UP GRAVITY CHAIN FOR SEPOLIA TESTNET              ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Chain ID: $CHAIN_ID"
echo "Home: $GRAVITY_HOME"
echo "ETH Address: $ETH_ADDRESS"
echo ""

# Initialize the chain
echo "Step 1: Initializing chain..."
gravity init $MONIKER --chain-id $CHAIN_ID --home $GRAVITY_HOME

# Create validator key
echo ""
echo "Step 2: Creating validator key..."
gravity keys add validator1 --keyring-backend test --home $GRAVITY_HOME 2>&1 | tee /tmp/validator1_key.txt

# Create orchestrator key
echo ""
echo "Step 3: Creating orchestrator key..."
gravity keys add orchestrator1 --keyring-backend test --home $GRAVITY_HOME 2>&1 | tee /tmp/orchestrator1_key.txt

# Get addresses
VALIDATOR_ADDR=$(gravity keys show validator1 -a --keyring-backend test --home $GRAVITY_HOME)
ORCHESTRATOR_ADDR=$(gravity keys show orchestrator1 -a --keyring-backend test --home $GRAVITY_HOME)

echo ""
echo "Validator Address: $VALIDATOR_ADDR"
echo "Orchestrator Address: $ORCHESTRATOR_ADDR"
echo "Ethereum Address: $ETH_ADDRESS"

# Add genesis account
echo ""
echo "Step 4: Adding genesis account..."
gravity genesis add-genesis-account $VALIDATOR_ADDR 1000000000000ugraviton --home $GRAVITY_HOME

# Create gentx with delegate keys
echo ""
echo "Step 5: Creating genesis transaction with delegate keys..."
gravity genesis gentx validator1 500000000ugraviton \
  --chain-id $CHAIN_ID \
  --keyring-backend test \
  --home $GRAVITY_HOME \
  --eth-address $ETH_ADDRESS \
  --orchestrator-address $ORCHESTRATOR_ADDR

# Collect gentxs
echo ""
echo "Step 6: Collecting genesis transactions..."
gravity genesis collect-gentxs --home $GRAVITY_HOME

# Fix bech32ibc nativeHRP
echo ""
echo "Step 7: Fixing genesis configuration..."
cd $GRAVITY_HOME/config
jq '.app_state.bech32ibc.nativeHRP = "gravity"' genesis.json > genesis_temp.json && mv genesis_temp.json genesis.json

# Set minimum gas price
sed -i '' 's/minimum-gas-prices = ""/minimum-gas-prices = "0ugraviton"/' app.toml

# Save keys to backup file
echo ""
echo "Step 8: Saving keys to backup file..."
cat > $GRAVITY_HOME/KEYS_BACKUP.txt << EOF
========================================
GRAVITY BRIDGE SEPOLIA TESTNET KEYS
Created: $(date)
Chain ID: $CHAIN_ID
========================================

--- VALIDATOR1 ---
$(cat /tmp/validator1_key.txt)

--- ORCHESTRATOR1 ---
$(cat /tmp/orchestrator1_key.txt)

--- ETHEREUM ADDRESS (Sepolia) ---
Address: $ETH_ADDRESS
(Private key stored in your .env file)

========================================
IMPORTANT ADDRESSES
========================================
Validator:    $VALIDATOR_ADDR
Orchestrator: $ORCHESTRATOR_ADDR
Ethereum:     $ETH_ADDRESS
========================================
EOF

# Cleanup temp files
rm -f /tmp/validator1_key.txt /tmp/orchestrator1_key.txt

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "✅ CHAIN SETUP COMPLETE!"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Keys saved to: $GRAVITY_HOME/KEYS_BACKUP.txt"
echo ""
echo "Next steps:"
echo ""
echo "1. Start the Cosmos chain:"
echo "   gravity start --home \$HOME/.gravity-local \\"
echo "     --rpc.laddr tcp://0.0.0.0:26657 \\"
echo "     --grpc.address 0.0.0.0:9090 \\"
echo "     --api.address tcp://0.0.0.0:1317 \\"
echo "     --api.enable true"
echo ""
echo "2. Start the orchestrator (after chain is running):"
echo "   Check KEYS_BACKUP.txt for the orchestrator mnemonic"
echo ""
