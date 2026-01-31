import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

// Gravity ID must match the one in your Cosmos chain genesis
const GRAVITY_ID = "defaultgravityid";

async function main() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║         DEPLOYING GRAVITY CONTRACTS TO SEPOLIA                 ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  const balance = await deployer.getBalance();

  console.log("📋 Deployment Configuration:");
  console.log("─".repeat(60));
  console.log(`   Deployer Address: ${deployer.address}`);
  console.log(`   Balance: ${ethers.utils.formatEther(balance)} ETH`);
  console.log(`   Network: Sepolia (Chain ID: 11155111)`);
  console.log(`   Gravity ID: ${GRAVITY_ID}`);
  console.log("");

  if (balance.lt(ethers.utils.parseEther("0.01"))) {
    console.error("❌ Insufficient balance. Need at least 0.01 ETH for deployment.");
    process.exit(1);
  }

  // Fetch validator set from Cosmos chain
  console.log("🔍 Fetching validator set from Cosmos chain...");

  let validators: string[] = [];
  let powers: number[] = [];
  let valsetNonce = 0;

  try {
    const cosmosRest = process.env.COSMOS_REST || "http://localhost:1317";
    const response = await fetch(`${cosmosRest}/gravity/v1beta/valset/current`);
    const data = await response.json() as any;

    if (data.valset && data.valset.members) {
      valsetNonce = parseInt(data.valset.nonce) || 0;
      for (const member of data.valset.members) {
        validators.push(member.ethereum_address);
        powers.push(parseInt(member.power));
      }
      console.log(`   Found ${validators.length} validators with nonce ${valsetNonce}`);
    }
  } catch (error) {
    console.log("   ⚠️  Could not fetch from Cosmos, using deployer as sole validator");
    validators = [deployer.address];
    powers = [2834678415]; // ~66% of 2^32
  }

  if (validators.length === 0) {
    validators = [deployer.address];
    powers = [2834678415];
  }

  console.log(`   Validators: ${validators.join(", ")}`);
  console.log(`   Powers: ${powers.join(", ")}`);
  console.log("");

  // Convert gravityId to bytes32
  const gravityIdBytes32 = ethers.utils.formatBytes32String(GRAVITY_ID);

  // Deploy Gravity contract
  console.log("🚀 Deploying Gravity.sol...");
  const Gravity = await ethers.getContractFactory("Gravity");

  // Convert powers to BigNumber array to avoid type issues
  const powersBN = powers.map(p => ethers.BigNumber.from(p.toString()));

  console.log(`   Gravity ID (bytes32): ${gravityIdBytes32}`);
  console.log(`   Validators: ${JSON.stringify(validators)}`);
  console.log(`   Powers: ${JSON.stringify(powers)}`);

  // Constructor: (bytes32 _gravityId, address[] _validators, uint256[] _powers)
  const gravity = await Gravity.deploy(
    gravityIdBytes32,
    validators,
    powersBN
  );
  await gravity.deployed();
  console.log(`   ✅ Gravity deployed at: ${gravity.address}`);
  console.log(`   Tx Hash: ${gravity.deployTransaction.hash}`);
  console.log("");

  // Deploy test ERC20 token
  console.log("🚀 Deploying TestERC20A.sol...");
  const TestERC20 = await ethers.getContractFactory("TestERC20A");
  const testToken = await TestERC20.deploy();
  await testToken.deployed();
  console.log(`   ✅ TestERC20A deployed at: ${testToken.address}`);
  console.log(`   Tx Hash: ${testToken.deployTransaction.hash}`);
  console.log("");

  // Save deployment info
  const deploymentInfo = {
    network: "sepolia",
    chainId: 11155111,
    deployer: deployer.address,
    gravityId: GRAVITY_ID,
    contracts: {
      Gravity: gravity.address,
      TestERC20A: testToken.address,
    },
    validators: validators,
    powers: powers,
    valsetNonce: valsetNonce,
    timestamp: new Date().toISOString(),
  };

  const deploymentPath = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentPath)) {
    fs.mkdirSync(deploymentPath, { recursive: true });
  }

  fs.writeFileSync(
    path.join(deploymentPath, "sepolia.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("═".repeat(60));
  console.log("📝 DEPLOYMENT SUMMARY");
  console.log("═".repeat(60));
  console.log(`   Gravity Contract:  ${gravity.address}`);
  console.log(`   TestERC20A Token:  ${testToken.address}`);
  console.log("");
  console.log("   Deployment info saved to: solidity/deployments/sepolia.json");
  console.log("");
  console.log("📋 NEXT STEPS:");
  console.log("─".repeat(60));
  console.log("   1. Update your orchestrator command with the new Gravity address");
  console.log("   2. Update bridge scripts with the new contract addresses");
  console.log("   3. Fund the TestERC20A contract or mint tokens for testing");
  console.log("");
  console.log("   Orchestrator command:");
  console.log(`   ./target/release/gbt orchestrator \\`);
  console.log(`     --cosmos-grpc http://localhost:9090 \\`);
  console.log(`     --ethereum-rpc ${process.env.SEPOLIA_RPC_URL} \\`);
  console.log(`     --ethereum-key "YOUR_PRIVATE_KEY" \\`);
  console.log(`     --cosmos-phrase "YOUR_ORCHESTRATOR_MNEMONIC" \\`);
  console.log(`     --fees 0ugraviton \\`);
  console.log(`     --gravity-contract-address ${gravity.address}`);
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
