const { ethers } = require("ethers");

// Configuration
const CONFIG = {
  ETHEREUM_RPC: "http://127.0.0.1:8545",
  ETHEREUM_PRIVATE_KEY: "0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122",
  GRAVITY_CONTRACT: "0xf4e77E5Da47AC3125140c470c71cBca77B5c638c",
  ERC20_TOKEN: "0x7c2C195CD6D34B8F845992d380aADB2730bB9C6F",
  COSMOS_DESTINATION: "gravity16hjzgzvqzysltxe4599qsgpwj3gpmu384ws95g",
  COSMOS_RPC: "http://localhost:1317",
};

// ABIs
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
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

async function waitForCosmosBalance(address, denom, expectedMinBalance, maxWaitMs = 60000) {
  const startTime = Date.now();
  console.log(`\n⏳ Waiting for tokens to arrive on Cosmos (max ${maxWaitMs / 1000}s)...`);

  while (Date.now() - startTime < maxWaitMs) {
    const balance = await getCosmosBalance(address, denom);
    if (BigInt(balance) >= BigInt(expectedMinBalance)) {
      return balance;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
    process.stdout.write(".");
  }

  return await getCosmosBalance(address, denom);
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let amount = "5000"; // Default amount in wei

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--amount" && args[i + 1]) {
      amount = args[i + 1];
    }
    if (args[i] === "--destination" && args[i + 1]) {
      CONFIG.COSMOS_DESTINATION = args[i + 1];
    }
    if (args[i] === "--token" && args[i + 1]) {
      CONFIG.ERC20_TOKEN = args[i + 1];
    }
  }

  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║           ETHEREUM → COSMOS BRIDGE TRANSFER                    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Connect to Ethereum
  const provider = new ethers.providers.JsonRpcProvider(CONFIG.ETHEREUM_RPC);
  const wallet = new ethers.Wallet(CONFIG.ETHEREUM_PRIVATE_KEY, provider);
  const erc20 = new ethers.Contract(CONFIG.ERC20_TOKEN, ERC20_ABI, wallet);
  const gravity = new ethers.Contract(CONFIG.GRAVITY_CONTRACT, GRAVITY_ABI, wallet);

  // Get token info
  let symbol = "TOKEN";
  let decimals = 18;
  try {
    symbol = await erc20.symbol();
    decimals = await erc20.decimals();
  } catch (e) {
    console.log("Could not fetch token metadata, using defaults");
  }

  const cosmosDenom = `gravity${CONFIG.ERC20_TOKEN}`;

  console.log("📋 Configuration:");
  console.log("─".repeat(60));
  console.log(`   Ethereum Address:    ${wallet.address}`);
  console.log(`   Cosmos Destination:  ${CONFIG.COSMOS_DESTINATION}`);
  console.log(`   Token Contract:      ${CONFIG.ERC20_TOKEN}`);
  console.log(`   Token Symbol:        ${symbol}`);
  console.log(`   Amount to Send:      ${amount} wei`);
  console.log(`   Gravity Contract:    ${CONFIG.GRAVITY_CONTRACT}`);
  console.log("");

  // ===== BEFORE BALANCES =====
  console.log("💰 BALANCES BEFORE TRANSFER:");
  console.log("─".repeat(60));

  const ethBalanceBefore = await erc20.balanceOf(wallet.address);
  const cosmosBalanceBefore = await getCosmosBalance(CONFIG.COSMOS_DESTINATION, cosmosDenom);

  console.log(`   [Ethereum] ${symbol}: ${ethBalanceBefore.toString()} wei`);
  console.log(`   [Cosmos]   ${cosmosDenom}: ${cosmosBalanceBefore} wei`);
  console.log("");

  // Validate balance
  if (ethBalanceBefore.lt(amount)) {
    console.error(`❌ Error: Insufficient balance. Have ${ethBalanceBefore.toString()}, need ${amount}`);
    process.exit(1);
  }

  // ===== APPROVE =====
  console.log("🔐 Step 1: Approving Gravity contract to spend tokens...");
  const approveTx = await erc20.approve(CONFIG.GRAVITY_CONTRACT, amount);
  console.log(`   Tx Hash: ${approveTx.hash}`);
  await approveTx.wait();
  console.log("   ✅ Approval confirmed\n");

  // ===== SEND TO COSMOS =====
  console.log("🚀 Step 2: Sending tokens to Gravity bridge...");
  const sendTx = await gravity.sendToCosmos(
    CONFIG.ERC20_TOKEN,
    CONFIG.COSMOS_DESTINATION,
    amount
  );
  console.log(`   Tx Hash: ${sendTx.hash}`);
  const receipt = await sendTx.wait();
  console.log(`   Block:   ${receipt.blockNumber}`);
  console.log("   ✅ Tokens locked in Gravity contract\n");

  // ===== WAIT FOR ORACLE =====
  console.log("🔮 Step 3: Waiting for orchestrator to relay the event...");
  const expectedCosmosBalance = BigInt(cosmosBalanceBefore) + BigInt(amount);
  const finalCosmosBalance = await waitForCosmosBalance(
    CONFIG.COSMOS_DESTINATION,
    cosmosDenom,
    expectedCosmosBalance.toString(),
    90000
  );
  console.log("\n");

  // ===== AFTER BALANCES =====
  console.log("💰 BALANCES AFTER TRANSFER:");
  console.log("─".repeat(60));

  const ethBalanceAfter = await erc20.balanceOf(wallet.address);

  console.log(`   [Ethereum] ${symbol}: ${ethBalanceAfter.toString()} wei`);
  console.log(`   [Cosmos]   ${cosmosDenom}: ${finalCosmosBalance} wei`);
  console.log("");

  // ===== SUMMARY =====
  console.log("📊 TRANSFER SUMMARY:");
  console.log("─".repeat(60));
  const ethDiff = ethBalanceBefore.sub(ethBalanceAfter);
  const cosmosDiff = BigInt(finalCosmosBalance) - BigInt(cosmosBalanceBefore);

  console.log(`   Ethereum ${symbol} change: -${ethDiff.toString()} wei`);
  console.log(`   Cosmos balance change:     +${cosmosDiff.toString()} wei`);

  if (cosmosDiff > 0) {
    console.log("\n✅ SUCCESS: Tokens bridged from Ethereum to Cosmos!");
  } else {
    console.log("\n⚠️  WARNING: Cosmos balance hasn't updated yet.");
    console.log("   The orchestrator may still be processing. Check again in a few seconds.");
  }

  console.log("\n" + "═".repeat(60) + "\n");
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
