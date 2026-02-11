/**
 * Supported Blockchain Networks Configuration
 * Provides RPC endpoints, contract addresses, and token addresses for each chain
 */

export type ChainId = 84532 | 80002 | 421614;

export const SUPPORTED_CHAINS = {
  BASE_SEPOLIA: 84532,
  POLYGON_AMOY: 80002,
  ARBITRUM_SEPOLIA: 421614,
} as const;

export interface ChainConfig {
  id: ChainId;
  name: string;
  shortName: string;
  rpcUrl: string;
  blockExplorer: string;
  blockExplorerApi: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  contracts: {
    pointsToken: string;
    challengeFactory: string;
    challengeEscrow: string;
    pointsEscrow: string;
  };
  tokens: {
    eth: string;
    usdc: string;
    usdt: string;
  };
}

export const CHAIN_CONFIG: Record<ChainId, ChainConfig> = {
  // Base Sepolia
  [SUPPORTED_CHAINS.BASE_SEPOLIA]: {
    id: 84532,
    name: 'Base Sepolia',
    shortName: 'Base',
    rpcUrl: import.meta.env.VITE_BASE_SEPOLIA_RPC || 'https://sepolia.base.org',
    blockExplorer: 'https://sepolia.basescan.org',
    blockExplorerApi: 'https://api-sepolia.basescan.org/api',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      pointsToken: import.meta.env.VITE_BASE_POINTS_CONTRACT_ADDRESS || '0xe9d88bAFdfc8EE9d6B21B7002a17bD716eFedf40',
      challengeFactory: import.meta.env.VITE_BASE_CHALLENGE_FACTORY_ADDRESS || '0x2feF7B1498A99C5B1C371A106F807CB759cfD63c',
      challengeEscrow: import.meta.env.VITE_BASE_CHALLENGE_ESCROW_ADDRESS || '0x3c7926638f0e79e333556fef42f647B2E76F8C4e',
      pointsEscrow: import.meta.env.VITE_BASE_POINTS_ESCROW_ADDRESS || '0x0000000000000000000000000000000000000000',
    },
    tokens: {
      eth: '0x0000000000000000000000000000000000000000',
      usdc: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
      usdt: '0x3c499c542cEF5E3811e1192ce70d8cC7d307B653',
    },
  },

  // Polygon Amoy
  [SUPPORTED_CHAINS.POLYGON_AMOY]: {
    id: 80002,
    name: 'Polygon Amoy',
    shortName: 'Polygon',
    rpcUrl: import.meta.env.VITE_POLYGON_AMOY_RPC || 'https://rpc-amoy.polygon.technology',
    blockExplorer: 'https://amoy.polygonscan.com',
    blockExplorerApi: 'https://api-amoy.polygonscan.com/api',
    nativeCurrency: {
      name: 'Polygon',
      symbol: 'POL',
      decimals: 18,
    },
    contracts: {
      pointsToken: import.meta.env.VITE_POLYGON_POINTS_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000',
      challengeFactory: import.meta.env.VITE_POLYGON_CHALLENGE_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000',
      challengeEscrow: import.meta.env.VITE_POLYGON_CHALLENGE_ESCROW_ADDRESS || '0x0000000000000000000000000000000000000000',
      pointsEscrow: import.meta.env.VITE_POLYGON_POINTS_ESCROW_ADDRESS || '0x0000000000000000000000000000000000000000',
    },
    tokens: {
      eth: '0x0000000000000000000000000000000000000000',
      usdc: '0x41E94cB5eB3092Ec94a15db6B9123d1b2850b422', // Polygon Amoy USDC
      usdt: '0xB932d46b8e0f9ca6c1cA48E7da2Ca284bAAaC27A', // Polygon Amoy USDT
    },
  },

  // Arbitrum Sepolia
  [SUPPORTED_CHAINS.ARBITRUM_SEPOLIA]: {
    id: 421614,
    name: 'Arbitrum Sepolia',
    shortName: 'Arbitrum',
    rpcUrl: import.meta.env.VITE_ARBITRUM_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc',
    blockExplorer: 'https://sepolia.arbiscan.io',
    blockExplorerApi: 'https://api-sepolia.arbiscan.io/api',
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18,
    },
    contracts: {
      pointsToken: import.meta.env.VITE_ARBITRUM_POINTS_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000',
      challengeFactory: import.meta.env.VITE_ARBITRUM_CHALLENGE_FACTORY_ADDRESS || '0x0000000000000000000000000000000000000000',
      challengeEscrow: import.meta.env.VITE_ARBITRUM_CHALLENGE_ESCROW_ADDRESS || '0x0000000000000000000000000000000000000000',
      pointsEscrow: import.meta.env.VITE_ARBITRUM_POINTS_ESCROW_ADDRESS || '0x0000000000000000000000000000000000000000',
    },
    tokens: {
      eth: '0x0000000000000000000000000000000000000000',
      usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', // Arbitrum Sepolia USDC
      usdt: '0xf66F95Dc9F28f82fAf3a3a1d25Ab4cF4c4b7298c', // Arbitrum Sepolia USDT
    },
  },
};

// Get config for a specific chain
export function getChainConfig(chainId: number): ChainConfig | null {
  if (chainId === SUPPORTED_CHAINS.BASE_SEPOLIA) return CHAIN_CONFIG[84532];
  if (chainId === SUPPORTED_CHAINS.POLYGON_AMOY) return CHAIN_CONFIG[80002];
  if (chainId === SUPPORTED_CHAINS.ARBITRUM_SEPOLIA) return CHAIN_CONFIG[421614];
  return null;
}

// Get all supported chain IDs
export function getSupportedChainIds(): ChainId[] {
  return [
    SUPPORTED_CHAINS.BASE_SEPOLIA,
    SUPPORTED_CHAINS.POLYGON_AMOY,
    SUPPORTED_CHAINS.ARBITRUM_SEPOLIA,
  ] as ChainId[];
}

// Get default chain (Base Sepolia)
export function getDefaultChainId(): ChainId {
  return SUPPORTED_CHAINS.BASE_SEPOLIA as ChainId;
}
