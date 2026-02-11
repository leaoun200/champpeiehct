import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Get currency symbol from token address
 * Maps Ethereum token addresses to their currency symbols
 * Supports: ETH (native), USDC, USDT across multiple chains (Base, Ethereum, Polygon, Arbitrum)
 */
export function getCurrencySymbol(tokenAddress?: string): string {
  if (!tokenAddress || tokenAddress.trim() === '') {
    return "$"; // fallback to USD symbol for missing address
  }

  const lowerAddress = tokenAddress.toLowerCase().trim();

  // ETH (native token - zero address on any chain)
  if (lowerAddress === "0x0000000000000000000000000000000000000000") {
    return "Ξ"; // Unicode Ethereum symbol for visual distinction
  }

  // USDC addresses (Base, Polygon, Arbitrum, Ethereum, Test)
  const USDC_ADDRESSES = [
    "0x833589fcd6edb6e08f4c7c32d4f71b3566da8860", // Base Mainnet
    "0x1c7d4b196cb0c7b01d743fbc6116a792bf68cf5d", // Base Testnet (Sepolia)
    "0x036cbd53842c5426634e7929541ec2318f3dcf7e", // USDC (Base Sepolia - local mapping)
    "0x41e94cb5eb3092ec94a15db6b9123d1b2850b422", // Polygon
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // Ethereum Mainnet
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // Arbitrum One
  ];
  
  if (USDC_ADDRESSES.includes(lowerAddress)) {
    return "USDC";
  }

  // USDT addresses (Base, Polygon, Arbitrum, Ethereum)
  const USDT_ADDRESSES = [
    "0x3c499c542cef5e3811e1192ce70d8cc7d307b653", // Base Mainnet
    "0xb932d46b8e0f9ca6c1ca48e7da2ca284baaac27a", // Polygon
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", // Arbitrum One
    "0xdac17f958d2ee523a2206206994597c13d831ec7", // Ethereum Mainnet
  ];

  if (USDT_ADDRESSES.includes(lowerAddress)) {
    return "USDT";
  }

  // Unknown token - should not happen in production but return descriptive fallback
  console.warn(`⚠️ Unknown token address: ${tokenAddress}`);
  return "TOKEN";
}

export function getCurrencyLogo(tokenAddress?: string): string {
  if (!tokenAddress || tokenAddress.trim() === '') {
    return "/assets/usd-coin-usdc-logo.svg"; // fallback to USDC
  }

  const lowerAddress = tokenAddress.toLowerCase().trim();

  // ETH (native token - zero address on any chain)
  if (lowerAddress === "0x0000000000000000000000000000000000000000") {
    return "/assets/ethereum-eth-logo.svg"; // ETH logo
  }

  // USDC addresses (Base, Polygon, Arbitrum, Ethereum, Test)
  const USDC_ADDRESSES = [
    "0x833589fcd6edb6e08f4c7c32d4f71b3566da8860", // Base Mainnet
    "0x1c7d4b196cb0c7b01d743fbc6116a792bf68cf5d", // Base Testnet (Sepolia)
    "0x036cbd53842c5426634e7929541ec2318f3dcf7e", // USDC (Base Sepolia - local mapping)
    "0x41e94cb5eb3092ec94a15db6b9123d1b2850b422", // Polygon
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // Ethereum Mainnet
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // Arbitrum One
  ];
  
  if (USDC_ADDRESSES.includes(lowerAddress)) {
    return "/assets/usd-coin-usdc-logo.svg";
  }

  // USDT addresses (Base, Polygon, Arbitrum, Ethereum)
  const USDT_ADDRESSES = [
    "0x3c499c542cef5e3811e1192ce70d8cc7d307b653", // Base Mainnet
    "0xb932d46b8e0f9ca6c1ca48e7da2ca284baaac27a", // Polygon
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", // Arbitrum One
    "0xdac17f958d2ee523a2206206994597c13d831ec7", // Ethereum Mainnet
  ];

  if (USDT_ADDRESSES.includes(lowerAddress)) {
    return "/assets/usdt-logo.svg";
  }

  // Unknown token - return USDC as fallback
  return "/assets/usd-coin-usdc-logo.svg";
}

/**
 * Format token amount for display with proper decimal places and shorthand notation
 * Handles small amounts (0.0007 ETH) and large amounts (1000.50 USDC → 1k)
 * Uses shorthand: k (thousands), m (millions), b (billions)
 * Never shows as "0" unless the amount is actually zero
 */
export function formatTokenAmount(amount: number | string | undefined | null): string {
  if (amount === null || amount === undefined || amount === '') {
    return '0';
  }

  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  // Handle NaN or invalid numbers
  if (isNaN(num)) {
    return '0';
  }

  // For zero, return as-is
  if (num === 0) {
    return '0';
  }

  // For very small numbers (< 0.01), round up to 2 decimal places minimum
  if (Math.abs(num) < 0.01) {
    // Round up to at least 0.01 for better readability
    const rounded = Math.max(num, 0.01);
    return rounded.toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 4 
    });
  }

  // For normal numbers (< 1000), show up to 4 decimal places
  if (Math.abs(num) < 1000) {
    const str = num.toFixed(4);
    return parseFloat(str).toLocaleString('en-US', { 
      minimumFractionDigits: 0, 
      maximumFractionDigits: 4 
    });
  }

  // For large numbers, use shorthand notation
  const absNum = Math.abs(num);
  let divisor = 1;
  let suffix = '';

  if (absNum >= 1000000000) {
    divisor = 1000000000;
    suffix = 'b';
  } else if (absNum >= 1000000) {
    divisor = 1000000;
    suffix = 'm';
  } else if (absNum >= 1000) {
    divisor = 1000;
    suffix = 'k';
  }

  const shorthandNum = num / divisor;
  const formatted = shorthandNum.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  });

  return `${formatted}${suffix}`;
}

/**
 * Determine display currency for challenge volume
 * Returns { currency, amount, logo } 
 * For very small ETH amounts (< 0.001 ETH), convert to USDC equivalent for readability
 * Uses approximate exchange rate of 1 ETH = $3500 USDC
 */
export function getDisplayCurrency(
  amount: number | string | undefined,
  tokenAddress: string | undefined
): { currency: string; amount: number; logo: string } {
  const ethThreshold = 0.001; // Switch to USDC if less than 0.001 ETH
  const ethToUsdcRate = 3500; // 1 ETH = $3500 (approximate)
  const token = tokenAddress || '0x0000000000000000000000000000000000000000';
  const isETH = token === '0x0000000000000000000000000000000000000000';
  
  // Convert string to number if needed
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (!numAmount || isNaN(numAmount)) {
    return { currency: isETH ? 'Ξ' : 'USDC', amount: 0, logo: getCurrencyLogo(token) };
  }

  // Convert from wei if amount is stored in wei format (all challenges store in wei)
  let displayAmount = numAmount;
  
  if (isETH) {
    // ETH: always assume amount is in wei (stored in database as wei)
    // Convert from wei to ETH
    const ethAmount = numAmount / 1e18;
    
    // If less than threshold, convert to USDC for readability
    if (ethAmount < ethThreshold) {
      const usdcAmount = ethAmount * ethToUsdcRate;
      return {
        currency: 'USDC',
        amount: usdcAmount,
        logo: getCurrencyLogo('0x036CBD53842c5426634e7929541ec2318f3dcf7e'), // USDC address
      };
    }
    
    displayAmount = ethAmount;
  } else {
    // USDC/USDT: only convert if the amount looks like it's in units of 10^-6 (e.g., > 1,000,000)
    // Most users won't enter a million dollar stake in the UI, so this is a safe heuristic.
    if (numAmount >= 1000000) {
      displayAmount = numAmount / 1e6;
    }
  }

  return {
    currency: getCurrencySymbol(token),
    amount: displayAmount,
    logo: getCurrencyLogo(token),
  };
}

/**
 * Format user display name for UI
 * Priority: username > wallet address > firstName/lastName > Privy ID
 * For wallet-connected users without username, shows truncated wallet (0x1234...5678)
 */
export function formatUserDisplayName(user?: {
  id?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  primaryWalletAddress?: string;
}): string {
  // Priority 1: Username (if user set one)
  if (user?.username && !user.username.startsWith('did:privy:')) {
    return user.username;
  }

  // Priority 2: Wallet address (for wallet-connected users)
  if (user?.primaryWalletAddress) {
    const addr = user.primaryWalletAddress;
    if (addr.startsWith('0x') && addr.length > 10) {
      return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    }
    return addr;
  }

  // Priority 3: First name + last name
  if (user?.firstName) {
    if (user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    return user.firstName;
  }

  // Priority 4: Extract readable wallet address from Privy ID
  if (user?.id?.startsWith('did:privy:')) {
    const parts = user.id.split(':');
    if (parts.length >= 3) {
      const walletId = parts[2];
      if (walletId.startsWith('0x') && walletId.length > 10) {
        return `${walletId.slice(0, 6)}...${walletId.slice(-4)}`;
      }
      return walletId.length > 8 ? `${walletId.slice(0, 8)}...` : walletId;
    }
  }

  // Last resort: Show truncated user ID
  return user?.id ? (user.id.length > 8 ? `${user.id.slice(0, 8)}...` : user.id) : "User";
}
