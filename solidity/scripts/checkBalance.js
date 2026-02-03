const { ethers } = require('ethers');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

/**
 * Check ERC20 token balance on Ethereum (Sepolia)
 * Usage: node scripts/checkBalance.js <address> [token-address]
 */

async function main() {
  const address = process.argv[2];
  const tokenAddress = process.argv[3] || process.env.ERC20_TOKEN || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
  const rpcUrl = process.env.SEPOLIA_RPC_URL;

  if (!address) {
    console.error('Usage: node scripts/checkBalance.js <address> [token-address]');
    console.error('Example: node scripts/checkBalance.js 0xEcA3700800d2Ac7Bc84a5d5B2E748282A38A3a0C');
    process.exit(1);
  }

  if (!rpcUrl) {
    console.error('❌ SEPOLIA_RPC_URL not set in .env');
    process.exit(1);
  }

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           ETHEREUM BALANCE CHECKER                             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  // Get ETH balance
  console.log('📍 Address:', address);
  console.log('');

  try {
    const ethBalance = await provider.getBalance(address);
    console.log('💰 ETH Balance:');
    console.log(`   ${ethers.utils.formatEther(ethBalance)} ETH`);
    console.log('');
  } catch (error) {
    console.error('❌ Failed to get ETH balance:', error.message);
  }

  // Get ERC20 balance
  console.log('🪙  ERC20 Token Balance:');
  console.log(`   Token: ${tokenAddress}`);

  try {
    const erc20 = new ethers.Contract(
      tokenAddress,
      [
        'function balanceOf(address) view returns (uint256)',
        'function decimals() view returns (uint8)',
        'function symbol() view returns (string)',
        'function name() view returns (string)'
      ],
      provider
    );

    const [balance, decimals, symbol, name] = await Promise.all([
      erc20.balanceOf(address),
      erc20.decimals(),
      erc20.symbol(),
      erc20.name()
    ]);

    console.log(`   Name: ${name}`);
    console.log(`   Symbol: ${symbol}`);
    console.log(`   Balance: ${ethers.utils.formatUnits(balance, decimals)} ${symbol}`);
    console.log(`   Raw: ${balance.toString()}`);
    console.log('');

  } catch (error) {
    console.error(`   ❌ Failed to get token balance: ${error.message}`);
  }

  console.log('═'.repeat(60));
  console.log('');
  console.log('View on Etherscan:');
  console.log(`https://sepolia.etherscan.io/address/${address}`);
  console.log('');
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
