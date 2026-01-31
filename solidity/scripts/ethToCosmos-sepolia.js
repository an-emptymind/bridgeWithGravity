const { ethers } = require("ethers");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();

// Load deployment info
function loadDeployment() {
  const deploymentPath = path.join(__dirname, "../deployments/sepolia.json");
  if (fs.existsSync(deploymentPath)) {
    return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  }
  return null;
}

// Configuration - loaded from environment and deployment
const deployment = loadDeployment();

const CONFIG = {
  ETHEREUM_RPC: process.env.SEPOLIA_RPC_URL,
  ETHEREUM_PRIVATE_KEY: process.env.SEPOLIA_PRIVATE_KEY,
  GRAVITY_CONTRACT: deployment?.contracts?.Gravity || process.env.GRAVITY_CONTRACT,
  ERC20_TOKEN: deployment?.contracts?.USDC || deployment?.contracts?.TestERC20A || process.env.ERC20_TOKEN,
  COSMOS_DESTINATION: process.env.COSMOS_DESTINATION || "gravity179y7cr3arkcp02zp4melft0sn5qn73x8kkwfk6",
  COSMOS_RPC: process.env.COSMOS_REST || "http://localhost:1317",
};

// ABIs
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function mint(address to, uint256 amount)",
];

const GRAVITY_ABI = [
  "function sendToCosmos(address _tokenContract, string calldata _destination, uint256 _amount)",
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

async function waitForCosmosBalance(address, denom, expectedMinBalance, maxWaitMs = 300000) {
  const startTime = Date.now();
  console.log(`\n⏳ Waiting for tokens to arrive on Cosmos (max ${maxWaitMs / 1000}s)...`);
  console.log("   (Sepolia block time is ~12s, so this may take a few minutes)");

  while (Date.now() - startTime < maxWaitMs) {
    const balance = await getCosmosBalance(address, denom);
    if (BigInt(balance) >= BigInt(expectedMinBalance)) {
      return balance;
    }
    await new Promise((resolve) => setTimeout(resolve, 15000)); // Check every 15s for Sepolia
    process.stdout.write(".");
  }

  return await getCosmosBalance(address, denom);
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
  let amountArg = "0.1"; // Default: 0.1 tokens (will use actual decimals)

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--amount" && args[i + 1]) {
      amountArg = args[i + 1];
    }
    if (args[i] === "--destination" && args[i + 1]) {
      CONFIG.COSMOS_DESTINATION = args[i + 1];
    }
    if (args[i] === "--token" && args[i + 1]) {
      CONFIG.ERC20_TOKEN = args[i + 1];
    }
  }

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║      SEPOLIA → COSMOS BRIDGE TRANSFER                          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Connect to Sepolia
  const provider = new ethers.providers.JsonRpcProvider(CONFIG.ETHEREUM_RPC);
  const wallet = new ethers.Wallet(CONFIG.ETHEREUM_PRIVATE_KEY, provider);
  const erc20 = new ethers.Contract(CONFIG.ERC20_TOKEN, ERC20_ABI, wallet);
  const gravity = new ethers.Contract(CONFIG.GRAVITY_CONTRACT, GRAVITY_ABI, wallet);

  // Get network info
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

  // Parse amount with correct decimals
  const amount = ethers.utils.parseUnits(amountArg, decimals);

  const cosmosDenom = `gravity${CONFIG.ERC20_TOKEN}`;

  console.log("📋 Configuration:");
  console.log("─".repeat(60));
  console.log(`   Network:             Sepolia (Chain ID: ${network.chainId})`);
  console.log(`   Ethereum Address:    ${wallet.address}`);
  console.log(`   Cosmos Destination:  ${CONFIG.COSMOS_DESTINATION}`);
  console.log(`   Token Contract:      ${CONFIG.ERC20_TOKEN}`);
  console.log(`   Token Symbol:        ${symbol}`);
  console.log(`   Amount to Send:      ${ethers.utils.formatUnits(amount, decimals)} ${symbol}`);
  console.log(`   Gravity Contract:    ${CONFIG.GRAVITY_CONTRACT}`);
  console.log("");

  // Check ETH balance for gas
  const ethBalance = await wallet.getBalance();
  console.log(`   ETH Balance (gas):   ${ethers.utils.formatEther(ethBalance)} ETH`);

  if (ethBalance.lt(ethers.utils.parseEther("0.001"))) {
    console.error("❌ Error: Insufficient ETH for gas. Need at least 0.001 ETH.");
    process.exit(1);
  }

  // ===== BEFORE BALANCES =====
  console.log("\n💰 BALANCES BEFORE TRANSFER:");
  console.log("─".repeat(60));

  const ethTokenBalanceBefore = await erc20.balanceOf(wallet.address);
  const cosmosBalanceBefore = await getCosmosBalance(CONFIG.COSMOS_DESTINATION, cosmosDenom);

  console.log(`   [Sepolia]  ${symbol}: ${ethers.utils.formatUnits(ethTokenBalanceBefore, decimals)}`);
  console.log(`   [Cosmos]   ${cosmosDenom.slice(0, 20)}...: ${ethers.utils.formatUnits(cosmosBalanceBefore, decimals)} ${symbol}`);
  console.log("");

  // Validate balance
  if (ethTokenBalanceBefore.lt(amount)) {
    console.error(`❌ Error: Insufficient ${symbol} balance.`);
    console.error(`   Have: ${ethers.utils.formatUnits(ethTokenBalanceBefore, decimals)}`);
    console.error(`   Need: ${ethers.utils.formatUnits(amount, decimals)}`);
    process.exit(1);
  }

  // ===== APPROVE =====
  console.log("🔐 Step 1: Approving Gravity contract to spend tokens...");
  const approveTx = await erc20.approve(CONFIG.GRAVITY_CONTRACT, amount);
  console.log(`   Tx Hash: ${approveTx.hash}`);
  console.log("   ⏳ Waiting for confirmation...");
  await approveTx.wait(2); // Wait for 2 confirmations on Sepolia
  console.log("   ✅ Approval confirmed\n");

  // ===== SEND TO COSMOS =====
  console.log("🚀 Step 2: Sending tokens to Gravity bridge...");
  const sendTx = await gravity.sendToCosmos(
    CONFIG.ERC20_TOKEN,
    CONFIG.COSMOS_DESTINATION,
    amount
  );
  console.log(`   Tx Hash: ${sendTx.hash}`);
  console.log("   ⏳ Waiting for confirmation...");
  const receipt = await sendTx.wait(2); // Wait for 2 confirmations
  console.log(`   Block:   ${receipt.blockNumber}`);
  console.log("   ✅ Tokens locked in Gravity contract\n");

  console.log("   View on Etherscan:");
  console.log(`   https://sepolia.etherscan.io/tx/${sendTx.hash}`);
  console.log("");

  // ===== WAIT FOR ORACLE =====
  console.log("🔮 Step 3: Waiting for orchestrator to relay the event...");
  console.log("   The orchestrator will observe the SendToCosmos event and submit a claim.");
  const expectedCosmosBalance = BigInt(cosmosBalanceBefore) + BigInt(amount.toString());
  const finalCosmosBalance = await waitForCosmosBalance(
    CONFIG.COSMOS_DESTINATION,
    cosmosDenom,
    expectedCosmosBalance.toString(),
    300000 // 5 minutes max wait
  );
  console.log("\n");

  // ===== AFTER BALANCES =====
  console.log("💰 BALANCES AFTER TRANSFER:");
  console.log("─".repeat(60));

  const ethTokenBalanceAfter = await erc20.balanceOf(wallet.address);

  console.log(`   [Sepolia]  ${symbol}: ${ethers.utils.formatUnits(ethTokenBalanceAfter, decimals)}`);
  console.log(`   [Cosmos]   ${cosmosDenom.slice(0, 20)}...: ${ethers.utils.formatUnits(finalCosmosBalance, decimals)} ${symbol}`);
  console.log("");

  // ===== SUMMARY =====
  console.log("📊 TRANSFER SUMMARY:");
  console.log("─".repeat(60));
  const ethDiff = ethTokenBalanceBefore.sub(ethTokenBalanceAfter);
  const cosmosDiff = BigInt(finalCosmosBalance) - BigInt(cosmosBalanceBefore);

  console.log(`   Sepolia ${symbol} change:  -${ethers.utils.formatUnits(ethDiff, decimals)}`);
  console.log(`   Cosmos balance change:     +${ethers.utils.formatUnits(cosmosDiff.toString(), decimals)} ${symbol}`);

  if (cosmosDiff > 0) {
    console.log("\n✅ SUCCESS: Tokens bridged from Sepolia to Cosmos!");
  } else {
    console.log("\n⚠️  WARNING: Cosmos balance hasn't updated yet.");
    console.log("   The orchestrator may still be processing. This can take a few minutes on Sepolia.");
    console.log("   Check orchestrator logs for progress.");
  }

  console.log("\n" + "═".repeat(60) + "\n");
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
