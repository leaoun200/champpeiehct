const { ethers } = require('ethers');

(async () => {
  try {
    const RPC = process.env.RPC_URL || process.env.BLOCKCHAIN_RPC_URL || 'https://sepolia.base.org';
    const FACTORY = process.env.FACTORY || process.env.VITE_CHALLENGE_FACTORY_ADDRESS || process.env.CONTRACT_FACTORY_ADDRESS || '';

    if (!FACTORY) {
      console.error('No factory address configured via env (VITE_CHALLENGE_FACTORY_ADDRESS or CONTRACT_FACTORY_ADDRESS)');
    }

    const provider = new ethers.JsonRpcProvider(RPC);

    const txHash = process.argv[2];
    if (txHash) {
      console.log('Looking up TX:', txHash);
      const tx = await provider.getTransaction(txHash);
      const receipt = await provider.getTransactionReceipt(txHash);
      console.log('Transaction:', tx || 'NOT FOUND');
      console.log('Receipt:', receipt || 'NOT FOUND');
    } else {
      console.log('No tx hash provided as arg; skipping tx lookup');
    }

    if (FACTORY) {
      console.log(`Checking contract code at factory address: ${FACTORY} (RPC: ${RPC})`);
      const code = await provider.getCode(FACTORY);
      console.log('Factory bytecode length:', code ? code.length : 0);
      if (!code || code === '0x') {
        console.log('No contract deployed at factory address (code == 0x)');
      } else {
        console.log('Contract appears deployed (bytecode present)');
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('Error in check-tx.cjs', err);
    process.exit(2);
  }
})();
