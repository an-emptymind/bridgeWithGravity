const { ethers } = require('ethers');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

/**
 * Check Ethereum block status and oracle indexing position
 *
 * Shows:
 * - Latest block (head of chain)
 * - Finalized block (confirmed, won't reorg)
 * - Safe block (reasonably safe)
 * - Oracle's last indexed block (from Gravity contract events)
 * - Block lag between latest and finalized
 */

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const gravityContract = process.env.GRAVITY_CONTRACT || '0x5cD8a71b841429a3218c14da6F17F1f9ba46098e';

  if (!rpcUrl) {
    console.error('❌ SEPOLIA_RPC_URL not set in .env');
    process.exit(1);
  }

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         ETHEREUM BLOCK STATUS & ORACLE INDEXING                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

  console.log('🔗 RPC Endpoint:', rpcUrl.split('/').slice(0, 3).join('/') + '/...');
  console.log('📍 Gravity Contract:', gravityContract);
  console.log('');

  try {
    // Get different block tags
    console.log('⏳ Fetching block information...\n');

    const [latestBlock, finalizedBlock, safeBlock] = await Promise.all([
      provider.getBlock('latest'),
      provider.getBlock('finalized').catch(() => null),
      provider.getBlock('safe').catch(() => null)
    ]);

    const latestBlockNumber = latestBlock.number;
    const finalizedBlockNumber = finalizedBlock ? finalizedBlock.number : null;
    const safeBlockNumber = safeBlock ? safeBlock.number : null;

    // Calculate time differences
    const now = Math.floor(Date.now() / 1000);
    const latestAge = now - latestBlock.timestamp;
    const finalizedAge = finalizedBlock ? now - finalizedBlock.timestamp : null;

    // Display block information
    console.log('📊 BLOCK STATUS:');
    console.log('─'.repeat(60));
    console.log(`   Latest Block:     ${latestBlockNumber.toLocaleString()}`);
    console.log(`   Timestamp:        ${new Date(latestBlock.timestamp * 1000).toLocaleString()}`);
    console.log(`   Age:              ${latestAge}s ago`);
    console.log('');

    if (finalizedBlock) {
      const blocksBehind = latestBlockNumber - finalizedBlockNumber;
      const timeBehind = finalizedAge;
      console.log(`   Finalized Block:  ${finalizedBlockNumber.toLocaleString()}`);
      console.log(`   Timestamp:        ${new Date(finalizedBlock.timestamp * 1000).toLocaleString()}`);
      console.log(`   Age:              ${timeBehind}s ago`);
      console.log(`   Lag:              ${blocksBehind} blocks (~${Math.floor(timeBehind / 60)} minutes)`);
      console.log('');
    } else {
      console.log('   Finalized Block:  Not available (older RPC or not supported)');
      console.log('');
    }

    if (safeBlock) {
      const blocksBehind = latestBlockNumber - safeBlockNumber;
      console.log(`   Safe Block:       ${safeBlockNumber.toLocaleString()}`);
      console.log(`   Lag:              ${blocksBehind} blocks behind latest`);
      console.log('');
    }

    // Get last event from Gravity contract (oracle's last indexed position)
    console.log('🔍 ORACLE INDEXING STATUS:');
    console.log('─'.repeat(60));

    const gravityInterface = new ethers.utils.Interface([
      'event SendToCosmosEvent(address indexed _tokenContract, address indexed _sender, string _destination, uint256 _amount, uint256 _eventNonce)',
      'event TransactionBatchExecutedEvent(uint256 indexed _batchNonce, address indexed _token, uint256 _eventNonce)',
      'event ValsetUpdatedEvent(uint256 indexed _newValsetNonce, uint256 _eventNonce, address[] _validators, uint256[] _powers)'
    ]);

    // Search for recent events (last 1000 blocks)
    const searchFrom = Math.max(0, latestBlockNumber - 1000);
    console.log(`   Searching last 1000 blocks (from ${searchFrom.toLocaleString()})...`);

    const logs = await provider.getLogs({
      address: gravityContract,
      fromBlock: searchFrom,
      toBlock: 'latest'
    });

    if (logs.length === 0) {
      console.log('   ⚠️  No events found in last 1000 blocks');
      console.log('   Oracle may be caught up or no bridge activity');
    } else {
      // Find the most recent event
      const lastLog = logs[logs.length - 1];
      const lastBlock = lastLog.blockNumber;
      const lastBlockData = await provider.getBlock(lastBlock);

      // Parse event to get nonce
      let eventType = 'Unknown';
      let eventNonce = 'N/A';
      try {
        const parsed = gravityInterface.parseLog(lastLog);
        eventType = parsed.name;
        eventNonce = parsed.args._eventNonce ? parsed.args._eventNonce.toString() : 'N/A';
      } catch {}

      const blocksSinceLastEvent = latestBlockNumber - lastBlock;
      const timeSinceLastEvent = now - lastBlockData.timestamp;

      console.log('');
      console.log(`   Last Event Type:  ${eventType}`);
      console.log(`   Last Event Nonce: ${eventNonce}`);
      console.log(`   Last Event Block: ${lastBlock.toLocaleString()}`);
      console.log(`   Event Timestamp:  ${new Date(lastBlockData.timestamp * 1000).toLocaleString()}`);
      console.log(`   Age:              ${Math.floor(timeSinceLastEvent / 60)} minutes ago`);
      console.log(`   Blocks since:     ${blocksSinceLastEvent} blocks`);
      console.log('');

      // Check if orchestrator is likely synced
      if (blocksSinceLastEvent < 100) {
        console.log('   ✅ Oracle appears to be synced (recent event detected)');
      } else {
        console.log('   ⚠️  No recent events detected');
        console.log('      • This is normal if there is no bridge activity');
        console.log('      • Oracle only processes events, not empty blocks');
      }
    }

    console.log('');

    // Block production rate
    console.log('⛓️  NETWORK INFO:');
    console.log('─'.repeat(60));

    const network = await provider.getNetwork();
    console.log(`   Network:          ${network.name} (Chain ID: ${network.chainId})`);

    // Estimate block time by looking at last 10 blocks
    try {
      const block1 = await provider.getBlock(latestBlockNumber - 10);
      const block2 = latestBlock;
      const avgBlockTime = (block2.timestamp - block1.timestamp) / 10;

      console.log(`   Avg Block Time:   ~${avgBlockTime.toFixed(1)}s (last 10 blocks)`);

      if (finalizedBlock) {
        const blocksToFinalize = latestBlockNumber - finalizedBlockNumber;
        const timeToFinalize = blocksToFinalize * avgBlockTime;
        console.log(`   Finalization:     ~${blocksToFinalize} blocks (~${Math.floor(timeToFinalize / 60)} min)`);
      }
    } catch (err) {
      console.log('   Avg Block Time:   Unable to calculate');
    }

    console.log('');

    // Show what orchestrator sees
    console.log('🤖 ORCHESTRATOR PERSPECTIVE:');
    console.log('─'.repeat(60));
    console.log('   When orchestrator starts, it logs:');
    console.log('   "Ethereum RPC has returned \'finalized\' block (X) and latest block (Y)"');
    console.log('');
    console.log('   Current values:');
    if (finalizedBlock) {
      console.log(`   Finalized: ${finalizedBlockNumber.toLocaleString()}`);
    } else {
      console.log(`   Finalized: Not available from this RPC`);
    }
    console.log(`   Latest:    ${latestBlockNumber.toLocaleString()}`);
    console.log('');

    if (finalizedBlock) {
      const lag = latestBlockNumber - finalizedBlockNumber;
      if (lag > 200) {
        console.log('   ⚠️  Large finalization lag detected');
        console.log('      This is normal on testnets but can delay oracle processing');
      } else {
        console.log('   ✅ Finalization lag is normal');
      }
    }

    console.log('');
    console.log('═'.repeat(60));
    console.log('');

    // Display refresh hint
    console.log('💡 Tips:');
    console.log('   • Run this script periodically to monitor block progress');
    console.log('   • Oracle processes events from finalized blocks (safer)');
    console.log('   • Lag between latest and finalized is normal (~2-5 minutes)');
    console.log('   • No recent events = no bridge activity (normal)');
    console.log('');
    console.log('   Run again: node scripts/checkEthBlocks.js');
    console.log('   Watch mode: watch -n 10 "node scripts/checkEthBlocks.js"');
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);

    if (error.message.includes('429') || error.message.includes('rate limit')) {
      console.error('\n💡 Rate limit hit. Try:');
      console.error('   • Waiting a few seconds and running again');
      console.error('   • Using a paid RPC tier (Alchemy, Infura)');
      console.error('   • Running your own Ethereum node');
    }

    process.exit(1);
  }
}

main();
