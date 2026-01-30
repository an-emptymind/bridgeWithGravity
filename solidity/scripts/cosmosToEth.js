const { ethers } = require("ethers");
const { exec } = require("child_process");
const { promisify } = require("util");

const execAsync = promisify(exec);

// Configuration
const CONFIG = {
  ETHEREUM_RPC: "http://127.0.0.1:8545",
  ETHEREUM_PRIVATE_KEY: "0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122",
  GRAVITY_CONTRACT: "0xf4e77E5Da47AC3125140c470c71cBca77B5c638c",
  ERC20_TOKEN: "0x7c2C195CD6D34B8F845992d380aADB2730bB9C6F",
  COSMOS_ADDRESS: "gravity16hjzgzvqzysltxe4599qsgpwj3gpmu384ws95g",
  COSMOS_KEY_NAME: "validator1",
  COSMOS_HOME: process.env.HOME + "/.gravity-local",
  CHAIN_ID: "gravity-local-1",
  COSMOS_RPC: "http://localhost:1317",
  ORCHESTRATOR_PATH: process.env.HOME + "/Raghav/newGravity/Gravity-Bridge/orchestrator",
  ETH_DESTINATION: "0xc783df8a850f42e7F7e57013759C285caa701eB6",
};

// ABIs
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function symbol() view returns (string)",
];

async function getCosmosBalance(address, denom) {
  try {
    const response = await fetch(
      `${CONFIG.COSMOS_RPC}/cosmos/bank/v1beta1/balances/${address}`
    );
    const data = await response.json();
    const balance = data.balances?.find((b) => b.denom === denom);
    return balance ? balance.amount : "0";
  } catch (error) {
    console.error("Error fetching Cosmos balance:", error.message);
    return "0";
  }
}

async function getEthBalance(provider, tokenAddress, walletAddress) {
  const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const balance = await erc20.balanceOf(walletAddress);
  return balance.toString();
}

async function runCommand(command, description) {
  console.log(`   Running: ${description}`);
  try {
    const { stdout, stderr } = await execAsync(command);
    return { success: true, stdout, stderr };
  } catch (error) {
    return { success: false, error: error.message, stdout: error.stdout, stderr: error.stderr };
  }
}

async function waitForEthBalance(provider, tokenAddress, walletAddress, expectedMinBalance, maxWaitMs = 60000) {
  const startTime = Date.now();
  console.log(`\n⏳ Waiting for tokens to arrive on Ethereum (max ${maxWaitMs / 1000}s)...`);

  while (Date.now() - startTime < maxWaitMs) {
    const balance = await getEthBalance(provider, tokenAddress, walletAddress);
    if (BigInt(balance) >= BigInt(expectedMinBalance)) {
      return balance;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
    process.stdout.write(".");
  }

  return await getEthBalance(provider, tokenAddress, walletAddress);
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let amount = "2000"; // Default amount in wei
  let bridgeFee = "1"; // Default bridge fee
  let chainFee = "1"; // Default chain fee

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--amount" && args[i + 1]) {
      amount = args[i + 1];
    }
    if (args[i] === "--destination" && args[i + 1]) {
      CONFIG.ETH_DESTINATION = args[i + 1];
    }
    if (args[i] === "--token" && args[i + 1]) {
      CONFIG.ERC20_TOKEN = args[i + 1];
    }
    if (args[i] === "--bridge-fee" && args[i + 1]) {
      bridgeFee = args[i + 1];
    }
    if (args[i] === "--chain-fee" && args[i + 1]) {
      chainFee = args[i + 1];
    }
  }

  const cosmosDenom = `gravity${CONFIG.ERC20_TOKEN}`;

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║           COSMOS → ETHEREUM BRIDGE TRANSFER                    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Connect to Ethereum
  const provider = new ethers.providers.JsonRpcProvider(CONFIG.ETHEREUM_RPC);
  const erc20 = new ethers.Contract(CONFIG.ERC20_TOKEN, ERC20_ABI, provider);

  // Get token info
  let symbol = "TOKEN";
  try {
    symbol = await erc20.symbol();
  } catch (e) {
    console.log("Could not fetch token metadata, using defaults");
  }

  console.log("📋 Configuration:");
  console.log("─".repeat(60));
  console.log(`   Cosmos Address:      ${CONFIG.COSMOS_ADDRESS}`);
  console.log(`   Ethereum Destination:${CONFIG.ETH_DESTINATION}`);
  console.log(`   Token Contract:      ${CONFIG.ERC20_TOKEN}`);
  console.log(`   Cosmos Denom:        ${cosmosDenom}`);
  console.log(`   Amount to Send:      ${amount} wei`);
  console.log(`   Bridge Fee:          ${bridgeFee} wei`);
  console.log(`   Chain Fee:           ${chainFee} wei`);
  console.log(`   Total Cost:          ${BigInt(amount) + BigInt(bridgeFee) + BigInt(chainFee)} wei`);
  console.log("");

  // ===== BEFORE BALANCES =====
  console.log("💰 BALANCES BEFORE TRANSFER:");
  console.log("─".repeat(60));

  const cosmosBalanceBefore = await getCosmosBalance(CONFIG.COSMOS_ADDRESS, cosmosDenom);
  const ethBalanceBefore = await getEthBalance(provider, CONFIG.ERC20_TOKEN, CONFIG.ETH_DESTINATION);

  console.log(`   [Cosmos]   ${cosmosDenom}: ${cosmosBalanceBefore} wei`);
  console.log(`   [Ethereum] ${symbol}: ${ethBalanceBefore} wei`);
  console.log("");

  // Validate balance
  const totalCost = BigInt(amount) + BigInt(bridgeFee) + BigInt(chainFee);
  if (BigInt(cosmosBalanceBefore) < totalCost) {
    console.error(`❌ Error: Insufficient balance. Have ${cosmosBalanceBefore}, need ${totalCost.toString()}`);
    process.exit(1);
  }

  // ===== SEND TO ETH =====
  console.log("🚀 Step 1: Sending tokens to bridge pool...");
  const sendCmd = `gravity tx gravity send-to-eth ${CONFIG.ETH_DESTINATION} ${amount}${cosmosDenom} ${bridgeFee}${cosmosDenom} ${chainFee}${cosmosDenom} --from ${CONFIG.COSMOS_KEY_NAME} --home ${CONFIG.COSMOS_HOME} --chain-id ${CONFIG.CHAIN_ID} --keyring-backend test --fees 0ugraviton -y`;

  const sendResult = await runCommand(sendCmd, "gravity tx gravity send-to-eth");
  if (!sendResult.success) {
    console.error("   ❌ Failed to send to eth:", sendResult.error);
    process.exit(1);
  }
  console.log("   ✅ Tokens added to bridge pool\n");

  // Small delay for tx to be included
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // ===== REQUEST BATCH =====
  console.log("📦 Step 2: Requesting batch creation...");
  const batchCmd = `gravity tx gravity request-batch ${CONFIG.ERC20_TOKEN} --from ${CONFIG.COSMOS_KEY_NAME} --home ${CONFIG.COSMOS_HOME} --chain-id ${CONFIG.CHAIN_ID} --keyring-backend test --fees 0ugraviton -y`;

  const batchResult = await runCommand(batchCmd, "gravity tx gravity request-batch");
  if (!batchResult.success) {
    console.error("   ❌ Failed to request batch:", batchResult.error);
    process.exit(1);
  }
  console.log("   ✅ Batch requested\n");

  // Wait for orchestrator to sign the batch
  console.log("⏳ Step 3: Waiting for orchestrator to sign the batch...");
  await new Promise((resolve) => setTimeout(resolve, 15000));
  console.log("   ✅ Waited for batch signatures\n");

  // ===== RELAY BATCH =====
  console.log("📡 Step 4: Relaying batch to Ethereum...");
  const relayCmd = `${CONFIG.ORCHESTRATOR_PATH}/target/release/gbt client spot-relay --ethereum-key "${CONFIG.ETHEREUM_PRIVATE_KEY}" --ethereum-rpc ${CONFIG.ETHEREUM_RPC} --cosmos-grpc http://localhost:9090 --gravity-contract-address ${CONFIG.GRAVITY_CONTRACT} --token ${CONFIG.ERC20_TOKEN}`;

  let relaySuccess = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`   Attempt ${attempt}/3...`);
    const relayResult = await runCommand(relayCmd, "gbt client spot-relay");

    if (relayResult.success || (relayResult.stdout && relayResult.stdout.includes("Successfully"))) {
      console.log("   ✅ Batch relayed to Ethereum\n");
      relaySuccess = true;
      break;
    } else if (relayResult.stderr && relayResult.stderr.includes("Failed to get sigs")) {
      console.log("   ⏳ Batch not signed yet, waiting...");
      await new Promise((resolve) => setTimeout(resolve, 10000));
    } else {
      console.log("   ⚠️  Relay attempt failed:", relayResult.stderr || relayResult.error);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  if (!relaySuccess) {
    console.log("   ⚠️  Could not relay batch after 3 attempts. It may be relayed by the orchestrator automatically.\n");
  }

  // ===== WAIT FOR ETHEREUM =====
  const expectedEthBalance = BigInt(ethBalanceBefore) + BigInt(amount) + BigInt(bridgeFee);
  const finalEthBalance = await waitForEthBalance(
    provider,
    CONFIG.ERC20_TOKEN,
    CONFIG.ETH_DESTINATION,
    expectedEthBalance.toString(),
    30000
  );
  console.log("\n");

  // ===== AFTER BALANCES =====
  console.log("💰 BALANCES AFTER TRANSFER:");
  console.log("─".repeat(60));

  const cosmosBalanceAfter = await getCosmosBalance(CONFIG.COSMOS_ADDRESS, cosmosDenom);

  console.log(`   [Cosmos]   ${cosmosDenom}: ${cosmosBalanceAfter} wei`);
  console.log(`   [Ethereum] ${symbol}: ${finalEthBalance} wei`);
  console.log("");

  // ===== SUMMARY =====
  console.log("📊 TRANSFER SUMMARY:");
  console.log("─".repeat(60));
  const cosmosDiff = BigInt(cosmosBalanceBefore) - BigInt(cosmosBalanceAfter);
  const ethDiff = BigInt(finalEthBalance) - BigInt(ethBalanceBefore);

  console.log(`   Cosmos balance change:   -${cosmosDiff.toString()} wei`);
  console.log(`   Ethereum balance change: +${ethDiff.toString()} wei`);
  console.log(`   (Includes bridge fee of ${bridgeFee} wei paid to relayer)`);

  if (ethDiff > 0) {
    console.log("\n✅ SUCCESS: Tokens bridged from Cosmos to Ethereum!");
  } else {
    console.log("\n⚠️  WARNING: Ethereum balance hasn't updated yet.");
    console.log("   The batch may still be processing. Check again in a few seconds.");
  }

  console.log("\n" + "═".repeat(60) + "\n");
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
