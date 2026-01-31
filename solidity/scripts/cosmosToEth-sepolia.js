const { ethers } = require("ethers");
const { exec } = require("child_process");
const { promisify } = require("util");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();
const execAsync = promisify(exec);

// Load deployment info
function loadDeployment() {
  const deploymentPath = path.join(__dirname, "../deployments/sepolia.json");
  if (fs.existsSync(deploymentPath)) {
    return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  }
  return null;
}

const deployment = loadDeployment();

// Configuration
const CONFIG = {
  ETHEREUM_RPC: process.env.SEPOLIA_RPC_URL,
  ETHEREUM_PRIVATE_KEY: process.env.SEPOLIA_PRIVATE_KEY,
  GRAVITY_CONTRACT: deployment?.contracts?.Gravity || process.env.GRAVITY_CONTRACT,
  ERC20_TOKEN: deployment?.contracts?.USDC || deployment?.contracts?.TestERC20A || process.env.ERC20_TOKEN,
  COSMOS_ADDRESS: process.env.COSMOS_ADDRESS || "gravity179y7cr3arkcp02zp4melft0sn5qn73x8kkwfk6",
  COSMOS_KEY_NAME: process.env.COSMOS_KEY_NAME || "validator1",
  COSMOS_HOME: process.env.COSMOS_HOME || process.env.HOME + "/.gravity-local",
  CHAIN_ID: process.env.CHAIN_ID || "gravity-sepolia-1",
  COSMOS_RPC: process.env.COSMOS_REST || "http://localhost:1317",
  ORCHESTRATOR_PATH: process.env.ORCHESTRATOR_PATH || process.env.HOME + "/Raghav/newGravity/Gravity-Bridge/orchestrator",
  ETH_DESTINATION: process.env.ETH_DESTINATION,
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

async function waitForEthBalance(provider, tokenAddress, walletAddress, expectedMinBalance, maxWaitMs = 300000) {
  const startTime = Date.now();
  console.log(`\n⏳ Waiting for tokens to arrive on Sepolia (max ${maxWaitMs / 1000}s)...`);
  console.log("   (Sepolia block time is ~12s, batch relay may take a few minutes)");

  while (Date.now() - startTime < maxWaitMs) {
    const balance = await getEthBalance(provider, tokenAddress, walletAddress);
    if (BigInt(balance) >= BigInt(expectedMinBalance)) {
      return balance;
    }
    await new Promise((resolve) => setTimeout(resolve, 15000)); // Check every 15s
    process.stdout.write(".");
  }

  return await getEthBalance(provider, tokenAddress, walletAddress);
}

async function main() {
  // Validate configuration
  if (!CONFIG.ETHEREUM_RPC) {
    console.error("❌ Error: SEPOLIA_RPC_URL not set in .env file");
    process.exit(1);
  }
  if (!CONFIG.ETHEREUM_PRIVATE_KEY) {
    console.error("❌ Error: SEPOLIA_PRIVATE_KEY not set in .env file");
    process.exit(1);
  }
  if (!CONFIG.GRAVITY_CONTRACT) {
    console.error("❌ Error: Gravity contract address not found. Run deploy-sepolia.ts first.");
    process.exit(1);
  }

  // Parse command line arguments
  const args = process.argv.slice(2);
  let amountArg = "0.05"; // Default amount (will use actual decimals)
  let bridgeFeeArg = "0.01"; // Bridge fee
  let chainFeeArg = "0.01"; // Chain fee

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--amount" && args[i + 1]) {
      amountArg = args[i + 1];
    }
    if (args[i] === "--destination" && args[i + 1]) {
      CONFIG.ETH_DESTINATION = args[i + 1];
    }
    if (args[i] === "--token" && args[i + 1]) {
      CONFIG.ERC20_TOKEN = args[i + 1];
    }
    if (args[i] === "--bridge-fee" && args[i + 1]) {
      bridgeFeeArg = args[i + 1];
    }
    if (args[i] === "--chain-fee" && args[i + 1]) {
      chainFeeArg = args[i + 1];
    }
  }

  // Set default ETH destination if not provided
  if (!CONFIG.ETH_DESTINATION) {
    const wallet = new ethers.Wallet(CONFIG.ETHEREUM_PRIVATE_KEY);
    CONFIG.ETH_DESTINATION = wallet.address;
  }

  const cosmosDenom = `gravity${CONFIG.ERC20_TOKEN}`;

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║      COSMOS → SEPOLIA BRIDGE TRANSFER                          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Connect to Sepolia
  const provider = new ethers.providers.JsonRpcProvider(CONFIG.ETHEREUM_RPC);
  const erc20 = new ethers.Contract(CONFIG.ERC20_TOKEN, [...ERC20_ABI, "function decimals() view returns (uint8)"], provider);
  const network = await provider.getNetwork();

  // Get token info
  let symbol = "TOKEN";
  let decimals = 18;
  try {
    symbol = await erc20.symbol();
    decimals = await erc20.decimals();
  } catch (e) {
    console.log("Could not fetch token metadata, using defaults");
  }

  // Parse amounts with correct decimals
  const amount = ethers.utils.parseUnits(amountArg, decimals);
  const bridgeFee = ethers.utils.parseUnits(bridgeFeeArg, decimals);
  const chainFee = ethers.utils.parseUnits(chainFeeArg, decimals);
  const totalCost = amount.add(bridgeFee).add(chainFee);

  console.log("📋 Configuration:");
  console.log("─".repeat(60));
  console.log(`   Network:             Sepolia (Chain ID: ${network.chainId})`);
  console.log(`   Cosmos Address:      ${CONFIG.COSMOS_ADDRESS}`);
  console.log(`   Sepolia Destination: ${CONFIG.ETH_DESTINATION}`);
  console.log(`   Token Contract:      ${CONFIG.ERC20_TOKEN}`);
  console.log(`   Cosmos Denom:        ${cosmosDenom.slice(0, 30)}...`);
  console.log(`   Amount to Send:      ${ethers.utils.formatUnits(amount, decimals)} ${symbol}`);
  console.log(`   Bridge Fee:          ${ethers.utils.formatUnits(bridgeFee, decimals)} ${symbol}`);
  console.log(`   Chain Fee:           ${ethers.utils.formatUnits(chainFee, decimals)} ${symbol}`);
  console.log(`   Total Cost:          ${ethers.utils.formatUnits(totalCost, decimals)} ${symbol}`);
  console.log("");

  // ===== BEFORE BALANCES =====
  console.log("💰 BALANCES BEFORE TRANSFER:");
  console.log("─".repeat(60));

  const cosmosBalanceBefore = await getCosmosBalance(CONFIG.COSMOS_ADDRESS, cosmosDenom);
  const ethBalanceBefore = await getEthBalance(provider, CONFIG.ERC20_TOKEN, CONFIG.ETH_DESTINATION);

  console.log(`   [Cosmos]   ${cosmosDenom.slice(0, 20)}...: ${ethers.utils.formatUnits(cosmosBalanceBefore, decimals)} ${symbol}`);
  console.log(`   [Sepolia]  ${symbol}: ${ethers.utils.formatUnits(ethBalanceBefore, decimals)}`);
  console.log("");

  // Validate balance
  if (BigInt(cosmosBalanceBefore) < BigInt(totalCost.toString())) {
    console.error(`❌ Error: Insufficient balance on Cosmos.`);
    console.error(`   Have: ${ethers.utils.formatUnits(cosmosBalanceBefore, decimals)} ${symbol}`);
    console.error(`   Need: ${ethers.utils.formatUnits(totalCost, decimals)} ${symbol}`);
    process.exit(1);
  }

  // ===== SEND TO ETH =====
  console.log("🚀 Step 1: Sending tokens to bridge pool...");
  const sendCmd = `gravity tx gravity send-to-eth ${CONFIG.ETH_DESTINATION} ${amount.toString()}${cosmosDenom} ${bridgeFee.toString()}${cosmosDenom} ${chainFee.toString()}${cosmosDenom} --from ${CONFIG.COSMOS_KEY_NAME} --home ${CONFIG.COSMOS_HOME} --chain-id ${CONFIG.CHAIN_ID} --keyring-backend test --fees 0ugraviton -y`;

  const sendResult = await runCommand(sendCmd, "gravity tx gravity send-to-eth");
  if (!sendResult.success) {
    console.error("   ❌ Failed to send to eth:", sendResult.error);
    process.exit(1);
  }
  console.log("   ✅ Tokens added to bridge pool\n");

  // Wait for tx to be included
  await new Promise((resolve) => setTimeout(resolve, 5000));

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
  console.log("   (This may take 15-30 seconds)");
  await new Promise((resolve) => setTimeout(resolve, 20000));
  console.log("   ✅ Waited for batch signatures\n");

  // ===== RELAY BATCH =====
  console.log("📡 Step 4: Relaying batch to Sepolia...");
  const relayCmd = `${CONFIG.ORCHESTRATOR_PATH}/target/release/gbt client spot-relay --ethereum-key "${CONFIG.ETHEREUM_PRIVATE_KEY}" --ethereum-rpc ${CONFIG.ETHEREUM_RPC} --cosmos-grpc http://localhost:9090 --gravity-contract-address ${CONFIG.GRAVITY_CONTRACT} --token ${CONFIG.ERC20_TOKEN}`;

  let relaySuccess = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`   Attempt ${attempt}/3...`);
    const relayResult = await runCommand(relayCmd, "gbt client spot-relay");

    if (relayResult.success || (relayResult.stdout && relayResult.stdout.includes("Successfully"))) {
      console.log("   ✅ Batch relayed to Sepolia\n");
      relaySuccess = true;
      break;
    } else if (relayResult.stderr && relayResult.stderr.includes("Failed to get sigs")) {
      console.log("   ⏳ Batch not signed yet, waiting...");
      await new Promise((resolve) => setTimeout(resolve, 15000));
    } else {
      console.log("   ⚠️  Relay attempt failed:", relayResult.stderr || relayResult.error);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
  }

  if (!relaySuccess) {
    console.log("   ⚠️  Could not relay batch after 3 attempts.");
    console.log("   The orchestrator may relay it automatically, or you can retry manually.\n");
  }

  // ===== WAIT FOR ETHEREUM =====
  const expectedEthBalance = BigInt(ethBalanceBefore) + BigInt(amount.toString()) + BigInt(bridgeFee.toString());
  const finalEthBalance = await waitForEthBalance(
    provider,
    CONFIG.ERC20_TOKEN,
    CONFIG.ETH_DESTINATION,
    expectedEthBalance.toString(),
    300000 // 5 minutes
  );
  console.log("\n");

  // ===== AFTER BALANCES =====
  console.log("💰 BALANCES AFTER TRANSFER:");
  console.log("─".repeat(60));

  const cosmosBalanceAfter = await getCosmosBalance(CONFIG.COSMOS_ADDRESS, cosmosDenom);

  console.log(`   [Cosmos]   ${cosmosDenom.slice(0, 20)}...: ${ethers.utils.formatUnits(cosmosBalanceAfter, decimals)} ${symbol}`);
  console.log(`   [Sepolia]  ${symbol}: ${ethers.utils.formatUnits(finalEthBalance, decimals)}`);
  console.log("");

  // ===== SUMMARY =====
  console.log("📊 TRANSFER SUMMARY:");
  console.log("─".repeat(60));
  const cosmosDiff = BigInt(cosmosBalanceBefore) - BigInt(cosmosBalanceAfter);
  const ethDiff = BigInt(finalEthBalance) - BigInt(ethBalanceBefore);

  console.log(`   Cosmos balance change:  -${ethers.utils.formatUnits(cosmosDiff.toString(), decimals)} ${symbol}`);
  console.log(`   Sepolia balance change: +${ethers.utils.formatUnits(ethDiff.toString(), decimals)} ${symbol}`);
  console.log(`   (Includes bridge fee of ${ethers.utils.formatUnits(bridgeFee, decimals)} paid to relayer)`);

  if (ethDiff > 0) {
    console.log("\n✅ SUCCESS: Tokens bridged from Cosmos to Sepolia!");
    console.log(`   View on Etherscan: https://sepolia.etherscan.io/address/${CONFIG.ETH_DESTINATION}`);
  } else {
    console.log("\n⚠️  WARNING: Sepolia balance hasn't updated yet.");
    console.log("   The batch may still be processing. Check again in a few minutes.");
    console.log("   You can also check the orchestrator logs for progress.");
  }

  console.log("\n" + "═".repeat(60) + "\n");
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
