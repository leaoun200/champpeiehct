import { usePrivy } from '@privy-io/react-auth';
import { useToast } from '@/hooks/use-toast';
import { useChain } from '@/hooks/useChain';
import { ethers } from 'ethers';
import { useState, useEffect } from 'react';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
];

const CHALLENGE_FACTORY_ABI = [
  'function createP2PChallenge(address participant, address paymentToken, uint256 stakeAmount, uint256 pointsReward, string calldata metadataURI) returns (uint256)',
  'function stakeAndCreateP2PChallenge(address participant, address paymentToken, uint256 stakeAmount, uint256 creatorSide, uint256 pointsReward, string metadataURI) payable returns (uint256)',
  'function acceptP2PChallenge(uint256 challengeId) payable',
  'function challenges(uint256 challengeId) view returns (tuple(uint256 id, uint8 challengeType, address creator, address participant, address paymentToken, uint256 stakeAmount, uint256 pointsReward, uint8 status, address winner, uint256 createdAt, uint256 resolvedAt, string metadataURI, uint8 creatorSide, uint8 participantSide, bool creatorStaked, bool participantStaked, uint256 stakedAt, uint256 refundRequestedAt, bool refundAccepted) challenge)',
];

interface CreateP2PChallengeParams {
  opponentAddress: string;
  stakeAmount: string; // in wei
  paymentToken: string;
  pointsReward: string;
  metadataURI: string;
}

interface AcceptChallengeParams {
  challengeId: number;
  stakeAmount: string; // in wei
  paymentToken: string;
  pointsReward: string;
  participantSide: number; // 0 = YES, 1 = NO (opposite of creator's side)
}

interface TransactionResult {
  transactionHash: string;
  blockNumber: number;
  status: 'success';
}

/**
 * Hook for user-initiated blockchain challenge operations
 * Handles signing and submitting transactions via Privy wallet
 */
export function useBlockchainChallenge() {
  const { user, ready, wallets } = usePrivy() as any;
  const { toast } = useToast();
  const { setChainId: setAppChainId } = useChain();
  const [isRetrying, setIsRetrying] = useState(false);
  const [currentChainId, setCurrentChainId] = useState<number>(84532); // Default to Base Sepolia

  // Chain configurations
  const CHAIN_CONFIGS: Record<number, any> = {
    84532: {
      name: 'Base Sepolia',
      rpc: 'https://sepolia.base.org',
      factoryAddress: import.meta.env.VITE_BASE_CHALLENGE_FACTORY_ADDRESS || import.meta.env.VITE_CHALLENGE_FACTORY_ADDRESS || '',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      blockExplorer: 'https://sepolia.basescan.org',
    },
    80002: {
      name: 'Polygon Amoy',
      rpc: 'https://rpc-amoy.polygon.technology',
      factoryAddress: import.meta.env.VITE_POLYGON_CHALLENGE_FACTORY_ADDRESS || '',
      nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
      blockExplorer: 'https://amoy.polygonscan.com',
    },
    421614: {
      name: 'Arbitrum Sepolia',
      rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
      factoryAddress: import.meta.env.VITE_ARBITRUM_CHALLENGE_FACTORY_ADDRESS || '',
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      blockExplorer: 'https://sepolia.arbiscan.io',
    },
  };

  // Listen to wallet chain changes and update app state
  useEffect(() => {
    const ethProvider = (window as any).ethereum;
    if (!ethProvider) return;

    const handleChainChanged = (chainIdHex: string) => {
      const newChainId = parseInt(chainIdHex, 16);
      console.log(`🔗 Wallet chain changed to: ${newChainId}`);
      setCurrentChainId(newChainId);
      setAppChainId(newChainId as any);
      
      // Show a subtle notification
      const chainConfig = CHAIN_CONFIGS[newChainId];
      if (chainConfig) {
        toast({
          title: '🔗 Wallet Network Changed',
          description: `Switched to ${chainConfig.name}`,
        });
      }
    };

    // Listen for chain change events
    ethProvider.on('chainChanged', handleChainChanged);

    // Cleanup
    return () => {
      ethProvider.removeListener('chainChanged', handleChainChanged);
    };
  }, []);

  const FACTORY_ADDRESS = CHAIN_CONFIGS[currentChainId]?.factoryAddress || '';
  const RPC_URL = CHAIN_CONFIGS[currentChainId]?.rpc || 'https://sepolia.base.org';
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 2000; // 2 seconds

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Try to produce an EIP-2612 permit signature for the token.
   * Returns an object { deadline, v, r, s } on success or null on failure.
   */
  // Permit removed - using traditional approve for simplicity

  /**
   * Switch wallet to specified chain
   * Supports: Base Sepolia (84532), Polygon Amoy (80002), Arbitrum Sepolia (421614)
   */
  const switchChain = async (targetChainId: number): Promise<void> => {
    const chainConfig = CHAIN_CONFIGS[targetChainId];
    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${targetChainId}`);
    }

    const chainIdHex = '0x' + targetChainId.toString(16);
    
    try {
      console.log(`🔄 SWITCHING WALLET TO ${chainConfig.name} (Chain ID: ${targetChainId})...`);

      // Get the wallet
      let wallet = null;
      
      if (user?.wallet) {
        console.log('🔍 Using connected external wallet from user.wallet');
        wallet = user.wallet;
      } else if (wallets && wallets.length > 0) {
        console.log('🔍 Using wallets array (embedded wallets)');
        const embeddedWallet = (wallets as any[]).find((w: any) => w.walletClientType === 'privy');
        wallet = embeddedWallet || wallets[0];
      }

      if (!wallet) {
        throw new Error('No wallet available. Please connect your wallet first.');
      }

      let ethProvider = null;

      // Get the correct provider based on wallet type
      if (wallet.walletClientType === 'privy') {
        // For Privy embedded wallet, use the wallet's provider
        ethProvider = (wallet as any).provider;
        console.log('📱 Using Privy embedded wallet provider...');
      } else {
        // For external wallets, try window.ethereum first
        ethProvider = (window as any).ethereum;
        console.log('📱 Using external wallet provider (window.ethereum)...');
      }

      if (!ethProvider) {
        throw new Error('No Web3 wallet detected. Please install MetaMask or connect a wallet.');
      }

      console.log(`📱 Wallet provider found, sending switch request to wallet...`);

      try {
        const result = await ethProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }],
        });
        console.log(`✅ Successfully switched to ${chainConfig.name}! Result:`, result);
        
        // Verify the switch worked by checking the current chain
        const currentChainIdResult = await ethProvider.request({
          method: 'eth_chainId',
        });
        console.log(`✅ Verified current chain ID: ${currentChainIdResult}`);
        
        // Update app state
        setCurrentChainId(targetChainId);
        
        // Show success toast
        toast({
          title: '✅ Network Switched',
          description: `Connected to ${chainConfig.name}`,
        });
        
      } catch (switchError: any) {
        console.log(`⚠️ Switch error code: ${switchError.code}`);
        
        if (switchError.code === 4902) {
          console.log(`🔗 ${chainConfig.name} not found in wallet, adding it...`);
          
          const addResult = await ethProvider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: chainIdHex,
                chainName: chainConfig.name,
                rpcUrls: [chainConfig.rpc],
                nativeCurrency: chainConfig.nativeCurrency,
                blockExplorerUrls: [chainConfig.blockExplorer],
              },
            ],
          });
          
          console.log(`✅ Successfully added ${chainConfig.name} to wallet! Result:`, addResult);
          
          // Now try to switch again
          console.log(`🔄 Now switching to newly added ${chainConfig.name}...`);
          const switchResult = await ethProvider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainIdHex }],
          });
          console.log(`✅ Successfully switched to ${chainConfig.name}!`);
          
          setCurrentChainId(targetChainId);
          
          toast({
            title: '✅ Network Added & Switched',
            description: `Connected to ${chainConfig.name}`,
          });
          
        } else if (switchError.code === 4001) {
          throw new Error('You rejected the network switch request. Please approve to continue.');
        } else {
          throw switchError;
        }
      }
      
    } catch (error: any) {
      console.error('❌ FAILED TO SWITCH NETWORK:', error);
      toast({
        title: '🚨 Network Switch Failed',
        description: error.message || `Please switch your wallet to ${chainConfig.name} (Chain ID: ${targetChainId})`,
        variant: 'destructive',
      });
      throw error;
    }
  };

  /**
   * Legacy function name for backward compatibility
   */
  const switchToBaseSepolia = async (): Promise<void> => {
    return switchChain(84532);
  };

  /**
   * Retry logic for failed transactions
   */
  const retryTransaction = async (
    fn: () => Promise<TransactionResult>,
    operationName: string
  ): Promise<TransactionResult> => {
    let lastError: any;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`🔄 ${operationName} attempt ${attempt}/${MAX_RETRIES}`);
        const result = await fn();
        return result;
      } catch (error: any) {
        lastError = error;
        console.error(`❌ Attempt ${attempt} failed:`, error.message);

        // Don't retry on user cancellation
        if (error.message?.includes('user rejected') || 
            error.message?.includes('User denied') ||
            error.code === 'ACTION_REJECTED') {
          console.log('⚠️ User cancelled transaction, not retrying');
          throw error;
        }

        // On last attempt, throw the error
        if (attempt === MAX_RETRIES) {
          console.error(`❌ All ${MAX_RETRIES} attempts failed`);
          throw error;
        }

        // Wait before retrying
        console.log(`⏳ Waiting ${RETRY_DELAY}ms before retry...`);
        await wait(RETRY_DELAY);
      }
    }

    throw lastError;
  };

  /**
   * Create a P2P challenge and submit to blockchain
   */
  const createP2PChallenge = async (params: CreateP2PChallengeParams): Promise<TransactionResult> => {
    try {
      if (!user) {
        throw new Error('User not authenticated');
      }

      console.log('🔍 Checking user object:', user);
      console.log('🔍 User wallet:', user?.wallet);
      console.log('🔍 Wallets array:', wallets);
      console.log('🔍 Privy ready:', ready);

      // Check if Privy is ready
      if (!ready) {
        throw new Error('Privy is not ready. Please wait for initialization.');
      }

      // In Privy v3, prioritize the connected wallet from user.wallet
      let wallet = null;

      // First try user.wallet (for connected external wallets like Rainbow, MetaMask, etc.)
      if (user?.wallet) {
        console.log('🔍 Using connected external wallet from user.wallet');
        wallet = user.wallet;
      }
      // Fallback to wallets array (for embedded wallets)
      else if (wallets && wallets.length > 0) {
        console.log('🔍 Using wallets array (embedded wallets)');
        const embeddedWallet = (wallets as any[]).find((w: any) => w.walletClientType === 'privy');
        if (embeddedWallet) {
          wallet = embeddedWallet;
          console.log('🔍 Found embedded wallet:', wallet);
        } else {
          // Use any available wallet
          wallet = wallets[0];
          console.log('🔍 Using first available wallet:', wallet);
        }
      }

      if (!wallet) {
        throw new Error('No wallet available. Please connect your wallet first.');
      }

      if (!wallet) {
        throw new Error('No wallet available. Please connect your wallet first.');
      }

      console.log('🔍 Selected wallet:', wallet);

      // Access the provider based on wallet type
      let provider = null;

      if ((wallet as any).walletClientType === 'privy') {
        console.log('  → Using Privy embedded wallet');
        // Embedded Privy wallet
        const ethProvider = (wallet as any).getEthereumProvider?.() || (wallet as any).provider;
        console.log('  → Got Ethereum provider:', !!ethProvider);
        provider = new ethers.BrowserProvider(ethProvider as any);
      } else {
        console.log('  → Using external wallet (MetaMask, Rainbow, etc.)');
        // External wallet (Rainbow, MetaMask, etc.)
        if ((window as any).ethereum) {
          console.log('  → window.ethereum available');
          // CRITICAL: For external wallets, we MUST request accounts first
          // This prompts the user to connect their accounts if needed
          try {
            console.log('  → Requesting accounts from wallet...');
            const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
            console.log('  → Accounts connected:', accounts?.length > 0 ? `${accounts.length} account(s)` : 'none');
            if (!accounts || accounts.length === 0) {
              throw new Error('No accounts connected. Please connect at least one account in your wallet.');
            }
          } catch (e: any) {
            console.error('  ❌ Failed to request accounts:', e?.message || e);
            throw new Error(`Failed to connect wallet: ${e?.message || 'Unknown error'}`);
          }
          provider = new ethers.BrowserProvider((window as any).ethereum);
        } else {
          console.error('❌ ERROR: No Ethereum provider available');
          throw new Error('No Ethereum provider available. Please install a Web3 wallet like MetaMask.');
        }
      }

      if (!provider) {
        console.error('❌ ERROR: Provider is null after creation');
        throw new Error('Ethereum provider not available');
      }

      // Get the signer from the provider
      console.log('  → Getting signer from provider...');
      const signer = await provider.getSigner();
      if (!signer) {
        throw new Error('Failed to get signer from wallet. Please ensure wallet is unlocked and has accounts.');
      }

      const userAddress = await signer.getAddress();

      console.log(`🔗 Creating P2P challenge from ${userAddress}...`);
      console.log(`📋 Contract address: ${FACTORY_ADDRESS}`);

      // Validate contract address
      if (!FACTORY_ADDRESS || FACTORY_ADDRESS === 'null' || FACTORY_ADDRESS === 'undefined') {
        throw new Error(`Invalid contract address: ${FACTORY_ADDRESS}. Please check VITE_CHALLENGE_FACTORY_ADDRESS environment variable.`);
      }

      // Create contract instance with user's signer
      const contract = new ethers.Contract(
        FACTORY_ADDRESS,
        CHALLENGE_FACTORY_ABI,
        signer
      );

      // Validate opponent address
      if (!params.opponentAddress || params.opponentAddress === 'null' || params.opponentAddress === 'undefined') {
        throw new Error('Invalid opponent address. Please select a valid opponent with a connected wallet.');
      }

      // Check if opponent address is a valid Ethereum address or a user ID
      const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(params.opponentAddress);
      if (!isValidAddress) {
        throw new Error(`Opponent address is not a valid wallet address: ${params.opponentAddress}. You may need to select a friend with a connected wallet.`);
      }

      // Convert amounts to BigInt
      const stakeWei = BigInt(params.stakeAmount);
      const pointsWei = BigInt(params.pointsReward);

      // Check and handle ERC20 allowance (only for non-ETH tokens)
      if (params.paymentToken !== '0x0000000000000000000000000000000000000000') {
        const tokenContract = new ethers.Contract(params.paymentToken, ERC20_ABI, signer);
        console.log('  → Checking balance and allowance on token contract...');
        const balance = await tokenContract.balanceOf(userAddress);
        const allowance = await tokenContract.allowance(userAddress, FACTORY_ADDRESS);
        const tokenLower = params.paymentToken.toLowerCase();
        
        console.log(`  → Balance: ${balance.toString()} wei, Allowance: ${allowance.toString()} wei, Need: ${stakeWei.toString()} wei`);

        if (balance < stakeWei) {
          throw new Error(`Insufficient USDC balance. Have: ${balance.toString()} wei, Need: ${stakeWei.toString()} wei`);
        }

        if (allowance < stakeWei) {
          // Get token name for user message
          let tokenName = 'TOKEN';
          if (tokenLower === '0x9eba6af5f65ecb20e65c0c9e0b5cdbbbe9c5c00c0') {
            tokenName = 'USDT';
          } else if (tokenLower === '0x036cbd53842c5426634e7929541ec2318f3dcf7e') {
            tokenName = 'USDC';
          }
          console.log(`🔓 Approving ${tokenName} for Challenge Factory...`);
          toast({
            title: 'Allowance Required',
            description: `Please approve ${tokenName} spend in your wallet...`,
          });
          const approveTx = await tokenContract.approve(FACTORY_ADDRESS, stakeWei);
          await approveTx.wait();
          console.log(`✅ ${tokenName} approved!`);
        }
      }

      // Checksum addresses to ensure proper format for ethers.js v6
      console.log(`🔍 Checksumming addresses...`);
      console.log(`   Raw opponent: ${params.opponentAddress}`);
      console.log(`   Raw token: ${params.paymentToken}`);
      
      let checksummedOpponent, checksummedToken;
      try {
        checksummedOpponent = ethers.getAddress(params.opponentAddress);
        console.log(`   ✓ Opponent checksummed: ${checksummedOpponent}`);
      } catch (e) {
        console.error(`   ✗ Failed to checksum opponent address:`, e);
        throw new Error(`Invalid opponent address format: ${params.opponentAddress}`);
      }
      
      try {
        checksummedToken = ethers.getAddress(params.paymentToken);
        console.log(`   ✓ Token checksummed: ${checksummedToken}`);
      } catch (e) {
        console.error(`   ✗ Failed to checksum token address:`, e);
        throw new Error(`Invalid token address format: ${params.paymentToken}`);
      }

      console.log(`📝 Transaction details:`);
      console.log(`   Opponent: ${checksummedOpponent}`);
      console.log(`   Stake: ${params.stakeAmount} wei`);
      console.log(`   Token: ${checksummedToken}`);
      console.log(`   Points: ${params.pointsReward}`);

      setIsRetrying(true);

  console.log('🔄 Setting isRetrying to true');
      // REQUIRED: Switch to Base Sepolia before sending transaction
      console.log('🔗 Switching to Base Sepolia...');
      await switchToBaseSepolia();
      console.log('✅ Switched to Base Sepolia');

      // Diagnostics: ensure contract exists at address
        console.log('🔍 Verifying contract exists at address...');
      try {
        console.log('  → Calling provider.getCode()...');
        const code = await provider.getCode(FACTORY_ADDRESS);
        console.log(`📦 Contract bytecode length: ${code ? code.length : 0} chars`);
        if (!code || code === '0x') {
          console.error(`❌ ERROR: No contract deployed at address ${FACTORY_ADDRESS}`);
          throw new Error(`No contract deployed at address ${FACTORY_ADDRESS}`);
        }
        console.log('✅ Contract verified at address');
      } catch (e) {
        console.error('❌ Failed to verify contract:', e);
      }

      console.log('📤 Calling retryTransaction...');

      return await retryTransaction(async () => {

        console.log('\n' + '='.repeat(80));
        console.log('⚙️  INSIDE retryTransaction - Preparing to submit transaction');
        console.log('='.repeat(80));
        // For native ETH, send the stake amount as msg.value.
        const isNativeETH = params.paymentToken === '0x0000000000000000000000000000000000000000';
        
        let tx;
        if (isNativeETH) {
          // For native ETH, include value in options
          tx = await contract.createP2PChallenge(
            checksummedOpponent,
            checksummedToken,
            stakeWei,
            pointsWei,
            params.metadataURI || '',
            { value: stakeWei }
          );
        } else {
          // For ERC20 tokens, no msg.value needed (token already approved)
          tx = await contract.createP2PChallenge(
            checksummedOpponent,
            checksummedToken,
            stakeWei,
            pointsWei,
            params.metadataURI || ''
          );
        }

        console.log(`⏳ Transaction submitted: ${tx.hash}`);
        toast({
          title: 'Transaction Submitted',
          description: `Hash: ${tx.hash?.slice(0, 10)}...`,
        });

        const receipt = await tx.wait();

        if (!receipt) {
          throw new Error('Transaction receipt is null');
        }

        console.log(`✅ P2P challenge created on-chain!`);
        console.log(`   TX: ${receipt.transactionHash}`);
        console.log(`   Block: ${receipt.blockNumber}`);

        return {
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          status: 'success' as const,
        };
      }, 'Create P2P Challenge');

    } catch (error: any) {
      console.error('Failed to create P2P challenge on-chain:', error);
      throw error;
    } finally {
      setIsRetrying(false);
    }
  };

  /**
   * Accept a P2P challenge and submit to blockchain
   */
  const acceptP2PChallenge = async (params: AcceptChallengeParams): Promise<TransactionResult> => {
    try {
      console.log('='.repeat(80));
      console.log('🚀 START: acceptP2PChallenge()');
      console.log('='.repeat(80));
      console.log('📥 Received params:', {
        challengeId: params.challengeId,
        stakeAmount: params.stakeAmount,
        paymentToken: params.paymentToken,
        participantSide: params.participantSide,
      });

      if (!user) {
        console.error('❌ ERROR: User not authenticated');
        throw new Error('User not authenticated');
      }
      console.log('✅ User authenticated:', user?.id);

      // Check if Privy is ready
      if (!ready) {
        console.error('❌ ERROR: Privy is not ready');
        throw new Error('Privy is not ready. Please wait for initialization.');
      }
      console.log('✅ Privy ready:', ready);

      // In Privy v3, prioritize the connected wallet from user.wallet
      let wallet = null;

      if (user?.wallet) {
        console.log('✅ Using connected external wallet from user.wallet');
        wallet = user.wallet;
      } else if (wallets && wallets.length > 0) {
        console.log('✅ Using wallets array (embedded wallets), count:', wallets.length);
        const embeddedWallet = (wallets as any[]).find((w: any) => w.walletClientType === 'privy');
        wallet = embeddedWallet || wallets[0];
      }

      if (!wallet) {
        console.error('❌ ERROR: No wallet available');
        throw new Error('No wallet available. Please connect your wallet first.');
      }

      console.log('✅ Selected wallet:', {
        walletClientType: (wallet as any).walletClientType,
        address: (wallet as any).address,
      });

      // Access the provider based on wallet type
      let provider = null;

      console.log('🔧 Creating provider...');
      if ((wallet as any).walletClientType === 'privy') {
        console.log('  → Using Privy embedded wallet');
        // Embedded Privy wallet
        const ethProvider = (wallet as any).getEthereumProvider?.() || (wallet as any).provider;
        console.log('  → Got Ethereum provider:', !!ethProvider);
        provider = new ethers.BrowserProvider(ethProvider as any);
      } else {
        console.log('  → Using external wallet (MetaMask, Rainbow, etc.)');
        // External wallet (Rainbow, MetaMask, etc.)
        if ((window as any).ethereum) {
          console.log('  → window.ethereum available');
          // CRITICAL: For external wallets, we MUST request accounts first
          // This prompts the user to connect their accounts if needed
          try {
            console.log('  → Requesting accounts from wallet...');
            const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
            console.log('  → Accounts connected:', accounts?.length > 0 ? `${accounts.length} account(s)` : 'none');
            if (!accounts || accounts.length === 0) {
              throw new Error('No accounts connected. Please connect at least one account in your wallet.');
            }
          } catch (e: any) {
            console.error('  ❌ Failed to request accounts:', e?.message || e);
            throw new Error(`Failed to connect wallet: ${e?.message || 'Unknown error'}`);
          }
          provider = new ethers.BrowserProvider((window as any).ethereum);
        } else {
          console.error('❌ ERROR: No Ethereum provider available');
          throw new Error('No Ethereum provider available. Please install a Web3 wallet like MetaMask.');
        }
      }

      if (!provider) {
        console.error('❌ ERROR: Provider is null after creation');
        throw new Error('Ethereum provider not available');
      }
      console.log('✅ Provider created successfully');

      // Get the signer from the provider
      console.log('🔧 Getting signer from provider...');
      const signer = await provider.getSigner();
      if (!signer) {
        console.error('❌ ERROR: Failed to get signer');
        throw new Error('Failed to get signer from wallet');
      }

      const userAddress = await signer.getAddress();
      console.log('✅ Signer obtained, address:', userAddress);

      console.log(`🔗 Accepting P2P challenge #${params.challengeId}...`);
      console.log(`📋 Contract address: ${FACTORY_ADDRESS}`);

      // Validate contract address
      if (!FACTORY_ADDRESS || FACTORY_ADDRESS === 'null' || FACTORY_ADDRESS === 'undefined') {
        console.error('❌ ERROR: Invalid contract address:', FACTORY_ADDRESS);
        throw new Error(`Invalid contract address: ${FACTORY_ADDRESS}. Please check VITE_CHALLENGE_FACTORY_ADDRESS environment variable.`);
      }
      console.log('✅ Contract address valid');

      console.log('🔧 Creating contract instance...');
      const contract = new ethers.Contract(
        FACTORY_ADDRESS,
        CHALLENGE_FACTORY_ABI,
        signer
      );
      console.log('✅ Contract instance created');

      // Convert amounts to BigInt
      const stakeWei = BigInt(params.stakeAmount);
      const pointsWei = BigInt(params.pointsReward);

      // Check and handle ERC20 allowance (only for non-ETH tokens)
      if (params.paymentToken !== '0x0000000000000000000000000000000000000000') {
        const tokenContract = new ethers.Contract(params.paymentToken, ERC20_ABI, signer);
        const allowance = await tokenContract.allowance(userAddress, FACTORY_ADDRESS);
        const balance = await tokenContract.balanceOf(userAddress);
        const tokenLower = params.paymentToken.toLowerCase();
        
        console.log(`  → Balance: ${balance.toString()}, Allowance: ${allowance.toString()}, Need: ${stakeWei.toString()}`);

        if (balance < stakeWei) {
          const tokenName = tokenLower === '0x036cbd53842c5426634e7929541ec2318f3dcf7e' ? 'USDC' : 'TOKEN';
          throw new Error(`Insufficient ${tokenName} balance`);
        }
        
        if (allowance < stakeWei) {
          // Get token name and request approval
          let tokenName = 'TOKEN';
          if (tokenLower === '0x9eba6af5f65ecb20e65c0c9e0b5cdbbbe9c5c00c0') {
            tokenName = 'USDT';
          } else if (tokenLower === '0x036cbd53842c5426634e7929541ec2318f3dcf7e') {
            tokenName = 'USDC';
          }
          toast({ title: 'Allowance Required', description: `Please approve ${tokenName} spend in your wallet...` });
          const approveTx = await tokenContract.approve(FACTORY_ADDRESS, stakeWei);
          await approveTx.wait();
          console.log(`✅ ${tokenName} approved!`);
        }
      }

      setIsRetrying(true);

      // REQUIRED: Switch to Base Sepolia before sending transaction
      await switchToBaseSepolia();

      // Diagnostics: ensure contract exists at address
      try {
        const code = await provider.getCode(FACTORY_ADDRESS);
        console.log(`📦 Contract code at ${FACTORY_ADDRESS}: ${code?.slice(0, 64)}... length=${code ? code.length : 0}`);
        if (!code || code === '0x') {
          throw new Error(`No contract deployed at address ${FACTORY_ADDRESS}`);
        }
      } catch (e) {
        console.error('Failed to fetch contract code:', e);
      }

      return await retryTransaction(async () => {
        console.log(`💳 Awaiting user to sign transaction...`);

        // ✅ FIX: Define checksummedToken that was missing
        const checksummedToken = ethers.getAddress(params.paymentToken);
  console.log('✅ Checksummed token:', checksummedToken);

        // Contract supports both ETH and ERC20 tokens
        const isNativeETH = checksummedToken === '0x0000000000000000000000000000000000000000';
        console.log('💰 Transaction details:', {
          isNativeETH,
          stakeWei: stakeWei.toString(),
          participantSide: params.participantSide === 0 ? 'YES (0)' : 'NO (1)',
          challengeId: params.challengeId,
        });

        console.log('💳 Requesting wallet signature...');
        let tx;

        try {
          if (isNativeETH) {
            console.log(`  → Sending native ETH: ${stakeWei.toString()} wei`);
            tx = await contract.acceptP2PChallenge(params.challengeId, { value: stakeWei });
          } else {
            console.log(`  → Sending ERC20 token (no value needed)`);
            console.log(`  → Calling contract.acceptP2PChallenge(${params.challengeId})`);
            tx = await contract.acceptP2PChallenge(params.challengeId);
          }
          console.log(`✅ Transaction signed! Hash: ${tx.hash}`);
        } catch (signError: any) {
          console.error('❌ User rejected transaction or error:', signError.message);
          throw signError;
        }

        console.log(`⏳ Waiting for transaction receipt...`);
        toast({
          title: 'Transaction Submitted',
          description: `Hash: ${(tx as any).hash?.slice(0, 10)}...`,
        });

  console.log('='.repeat(80));
        const receipt = await tx.wait();

        if (!receipt) {
          throw new Error('Transaction receipt is null');
        }

        console.log(`✅ P2P challenge accepted on-chain!`);
        console.log(`   TX Hash: ${receipt.transactionHash}`);
        console.log(`   Block: ${receipt.blockNumber}`);
        console.log('='.repeat(80));

        return {
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber,
          status: 'success' as const,
        };
      }, 'Accept P2P Challenge');

    } catch (error: any) {
      console.error('Failed to accept P2P challenge on-chain:', error);
      throw error;
    } finally {
      setIsRetrying(false);
    }
  };

  return {
    createP2PChallenge,
    acceptP2PChallenge,
    switchChain,
    factoryAddress: FACTORY_ADDRESS,
    isRetrying,
  };
}

// Export a convenience hook wrapper that provides the new stake+create flow
export async function stakeAndCreateP2PChallengeClient(params: {
  participantAddress: string;
  stakeAmountWei: string;
  paymentToken: string;
  pointsReward: string;
  metadataURI?: string;
  ethereumProvider?: any; // Optional: pass wallet provider from Privy
}) {
  // Lightweight wrapper that delegates to the on-chain contract using ethers
  // This mirrors logic in create/accept functions but keeps it simple for callers.
  const { participantAddress, stakeAmountWei, paymentToken, pointsReward, metadataURI, ethereumProvider } = params;

  console.log('🔗 [stakeAndCreateP2PChallengeClient] Starting on-chain stake creation...');
  
  // Use provided provider or fall back to window.ethereum
  let provider = null;
  if (ethereumProvider) {
    provider = new ethers.BrowserProvider(ethereumProvider);
    console.log('📱 Using provided wallet provider');
  } else if ((window as any).ethereum) {
    console.log('📱 Using window.ethereum provider');
    // CRITICAL: For external wallets, we MUST request accounts first
    // This prompts the user to connect their accounts if needed
    try {
      console.log('  → Requesting accounts from wallet...');
      const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
      console.log('  → Accounts connected:', accounts?.length > 0 ? `${accounts.length} account(s)` : 'none');
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts connected. Please connect at least one account in your wallet.');
      }
    } catch (e: any) {
      console.error('  ❌ Failed to request accounts:', e?.message || e);
      throw new Error(`Failed to connect wallet: ${e?.message || 'Unknown error'}`);
    }
    provider = new ethers.BrowserProvider((window as any).ethereum as any);
  } else {
    throw new Error('No wallet provider available. Please connect your wallet.');
  }
  
  const signer = await provider.getSigner();
  if (!signer) {
    throw new Error('Unable to get signer from wallet. Please ensure your wallet is unlocked and connected.');
  }
  
  // Get the current chain ID to determine the correct factory address
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  console.log(`📡 Detected chain ID: ${chainId}`);
  
  // Determine factory address based on chain
  let FACTORY_ADDRESS = '';
  const baseFactoryEnv = import.meta.env.VITE_BASE_CHALLENGE_FACTORY_ADDRESS;
  const polygonFactoryEnv = import.meta.env.VITE_POLYGON_CHALLENGE_FACTORY_ADDRESS;
  const arbitrumFactoryEnv = import.meta.env.VITE_ARBITRUM_CHALLENGE_FACTORY_ADDRESS;
  const defaultFactoryEnv = import.meta.env.VITE_CHALLENGE_FACTORY_ADDRESS;
  
  console.log(`📋 Environment variables loaded:`, { baseFactoryEnv, polygonFactoryEnv, arbitrumFactoryEnv, defaultFactoryEnv });
  
  if (chainId === 84532) { // Base Sepolia
    FACTORY_ADDRESS = baseFactoryEnv || defaultFactoryEnv || '';
  } else if (chainId === 8453) { // Base Mainnet
    FACTORY_ADDRESS = baseFactoryEnv || defaultFactoryEnv || '';
  } else if (chainId === 80002) { // Polygon Amoy
    FACTORY_ADDRESS = polygonFactoryEnv || '';
  } else if (chainId === 137) { // Polygon Mainnet
    FACTORY_ADDRESS = polygonFactoryEnv || '';
  } else if (chainId === 421614) { // Arbitrum Sepolia
    FACTORY_ADDRESS = arbitrumFactoryEnv || '';
  } else if (chainId === 42161) { // Arbitrum Mainnet
    FACTORY_ADDRESS = arbitrumFactoryEnv || '';
  } else {
    FACTORY_ADDRESS = defaultFactoryEnv || '';
  }
  
  console.log(`✅ Selected FACTORY_ADDRESS: ${FACTORY_ADDRESS}`);
  
  if (!FACTORY_ADDRESS || FACTORY_ADDRESS === 'null' || FACTORY_ADDRESS === 'undefined') {
    throw new Error(`Invalid contract address for chain ${chainId}. Please check your environment variables.`);
  }
  
  const factory = new ethers.Contract(
    FACTORY_ADDRESS,
    CHALLENGE_FACTORY_ABI,
    signer
  );

  const isNative = paymentToken === '0x0000000000000000000000000000000000000000';
  const stakeBig = BigInt(stakeAmountWei);

  // Check and handle ERC20 allowance if needed
  if (!isNative) {
    try {
      const tokenContract = new ethers.Contract(paymentToken, ERC20_ABI, signer);
      const ownerAddr = await signer.getAddress();
      
      // Check balance first
      const balance = await tokenContract.balanceOf(ownerAddr);
      console.log(`💰 Token balance: ${balance.toString()} wei`);
      if (balance < stakeBig) {
        throw new Error(`Insufficient balance. Have: ${balance.toString()} wei, Need: ${stakeBig.toString()} wei`);
      }
      
      // Then check allowance
      const currentAllowance = await tokenContract.allowance(ownerAddr, FACTORY_ADDRESS);
      if (BigInt(currentAllowance.toString ? currentAllowance.toString() : currentAllowance) < stakeBig) {
        console.log('🔐 Approving token spend for factory...');
        const approveTx = await tokenContract.approve(FACTORY_ADDRESS, stakeBig);
        console.log('⏳ Waiting for approve tx to confirm...', approveTx.hash);
        await approveTx.wait();
        console.log('✅ Approve confirmed');
      } else {
        console.log('✅ Existing allowance sufficient, no approve needed');
      }
    } catch (e) {
      console.warn('Failed to check balance/allowance:', e?.message || e);
      throw e; // Throw to prevent contract call with insufficient balance
    }
  }

  let tx;
  if (isNative) {
    tx = await factory.stakeAndCreateP2PChallenge(
      participantAddress,
      paymentToken,
      stakeBig,
      0, // creatorSide
      pointsReward,
      metadataURI || '',
      { value: stakeBig }
    );
  } else {
    tx = await factory.stakeAndCreateP2PChallenge(
      participantAddress,
      paymentToken,
      stakeBig,
      0, // creatorSide
      pointsReward,
      metadataURI || ''
    );
  }

  const receipt = await tx.wait();
  return { transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber };
}
