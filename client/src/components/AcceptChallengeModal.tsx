import { useState } from 'react';
import { useLocation } from 'wouter';
import { usePrivy } from '@privy-io/react-auth';
import { useBlockchainChallenge } from '@/hooks/useBlockchainChallenge';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/UserAvatar';
import { AlertCircle, CheckCircle, Loader, Shield, Coins, Trophy } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

// Category icon mapping
function getCategoryIcon(category?: string): string {
  const map: Record<string, string> = {
    crypto: '₿',
    sports: '⚽',
    gaming: '🎮',
    music: '🎵',
    politics: '🗳️',
    entertainment: '🎬',
    technology: '💻',
    finance: '💰',
    news: '📰',
    general: '🎯',
    trading: '📈',
    fitness: '🏃',
    skill: '🧠',
  };
  return (category && map[category.toLowerCase()]) || '🎯';
}

interface AcceptChallengeModalProps {
  isOpen: boolean;
  onClose: () => void;
  challenge: any;
  onSuccess?: () => void;
  isOpenChallenge?: boolean;
}

export function AcceptChallengeModal({
  isOpen,
  onClose,
  challenge,
  onSuccess,
  isOpenChallenge = false,
}: AcceptChallengeModalProps) {
  const [, setLocation] = useLocation();
  const { user, login, ready } = usePrivy();
  const { acceptP2PChallenge, isRetrying } = useBlockchainChallenge();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // DEBUG: Log the modal props
  console.log('📋 AcceptChallengeModal opened with:', {
    isOpen,
    isOpenChallenge,
    challengeId: challenge?.id,
    challengeType: challenge?.type || challenge?.challengeType || 'unknown',
  });

  // Fetch full challenge details if notification data is incomplete
  const { data: fullChallenge } = useQuery({
    queryKey: ['challenge', challenge?.id],
    queryFn: async () => {
      if (!challenge?.id) return null;
      try {
        const res = await apiRequest('GET', `/api/challenges/${challenge.id}`);
        return res;
      } catch (err) {
        console.warn('Failed to fetch full challenge details:', err);
        return null;
      }
    },
    enabled: isOpen && !!challenge?.id && (!challenge?.stakeAmount && !challenge?.stakeAmountWei && !challenge?.amount),
  });

  // Use full challenge data if available, otherwise fall back to notification data
  const enrichedChallenge = fullChallenge || challenge;

  if (!enrichedChallenge) return null;

  const challenger = enrichedChallenge.challengerUser;

  // Determine stake (per-side) in USDC; support multiple notification payload shapes
  const stakeInUSDC = (() => {
    try {
      console.log('🔍 Challenge object received:', {
        id: enrichedChallenge.id,
        stakeAmount: enrichedChallenge.stakeAmount,
        stakeAmountWei: enrichedChallenge.stakeAmountWei,
        amount: enrichedChallenge.amount,
        totalPool: enrichedChallenge.totalPool,
        paymentTokenAddress: enrichedChallenge.paymentTokenAddress,
        challengerUser: enrichedChallenge.challengerUser,
      });

      // 1) If wei value is present, determine decimals based on token type and convert
      if (enrichedChallenge.stakeAmountWei) {
        const weiStr = String(enrichedChallenge.stakeAmountWei);
        console.log('✓ Using stakeAmountWei:', weiStr);
        const weiBig = BigInt(weiStr);
        
        // Determine token decimals based on payment token address
        const tokenAddr = (enrichedChallenge.paymentTokenAddress || '0x0000000000000000000000000000000000000000').toLowerCase();
        const decimals = tokenAddr === '0x0000000000000000000000000000000000000000' ? 18 : 6; // ETH=18, tokens=6
        const divisor = BigInt(10) ** BigInt(decimals);
        const tokenAmount = Number(weiBig) / Number(divisor);
        
        console.log(`✓ Token decimals: ${decimals}, converted amount: ${tokenAmount}`);
        return tokenAmount.toFixed(2);
      }

      // 2) If explicit stakeAmount (per-side) is provided, use it directly
      if (enrichedChallenge.stakeAmount !== undefined && enrichedChallenge.stakeAmount !== null) {
        const val = Number(enrichedChallenge.stakeAmount);
        console.log('✓ Using stakeAmount:', val);
        if (!Number.isNaN(val)) return val.toFixed(2);
      }

      // 3) If only total amount is provided (total pool), and it's the 'amount' field,
      //    assume it's the total and use half for per-side if totalPool or total indicator exists
      if (enrichedChallenge.amount !== undefined && enrichedChallenge.totalPool !== undefined) {
        const total = Number(enrichedChallenge.amount);
        console.log('✓ Using amount/2 from totalPool:', total / 2);
        if (!Number.isNaN(total)) return (total / 2).toFixed(2);
      }

      // 4) Fallback to 'amount' as per-side if nothing else available
      const fallback = Number(enrichedChallenge.amount || 0);
      console.log('✓ Using fallback amount:', fallback);
      return (Number.isNaN(fallback) ? 0 : fallback).toFixed(2);
    } catch (err) {
      console.error('Error computing stakeInUSDC:', err);
      return '0.00';
    }
  })();

  // For Open Challenges, show creator's side and auto-assign opponent's side
  const creatorSide = enrichedChallenge.challengerSide || 'YES'; // Creator's choice
  const opponentSide = creatorSide === 'YES' ? 'NO' : 'YES'; // Auto-assigned opposite

  // Determine token type for logo display
  const getTokenLogo = () => {
    const tokenAddr = (enrichedChallenge.paymentTokenAddress || '0x0000000000000000000000000000000000000000').toLowerCase();
    if (tokenAddr === '0x0000000000000000000000000000000000000000') {
      return '/assets/eth-logo.svg'; // ETH logo
    } else if (tokenAddr === '0x036cbd53842c5426634e7929541ec2318f3dcf7e') {
      return '/assets/usd-coin-usdc-logo.svg'; // USDC logo
    }
    return '/assets/usd-coin-usdc-logo.svg'; // fallback
  };

  const getTokenSymbol = () => {
    const tokenAddr = (enrichedChallenge.paymentTokenAddress || '0x0000000000000000000000000000000000000000').toLowerCase();
    if (tokenAddr === '0x0000000000000000000000000000000000000000') {
      return 'ETH';
    } else if (tokenAddr === '0x036cbd53842c5426634e7929541ec2318f3dcf7e') {
      return 'USDC';
    }
    return 'TOKEN';
  };

  const handleAcceptChallenge = async () => {
    try {
      setIsSubmitting(true);
      setError(null);
      setTransactionHash(null);

      // For P2P Challenges: Check wallet connection first
      if (!isOpenChallenge) {
        console.log('🔗 P2P Challenge - Checking wallet connection...');
        console.log('   Privy ready:', ready);
        console.log('   User:', user);

        if (!ready) {
          throw new Error('Privy is not ready. Please refresh the page.');
        }

        if (!user) {
          console.log('⚠️ No wallet connected - prompting user to login...');
          toast({
            title: '🔐 Connect Wallet',
            description: 'Please connect your wallet to stake in this challenge.',
          });
          await login();
          return;
        }

        console.log('✅ Wallet connected - proceeding with blockchain transaction');
      }

      toast({
        title: 'Accepting Challenge',
        description: isOpenChallenge ? 'Locking stake in escrow...' : 'Connecting to blockchain...',
      });

      // Helper: send a copy of client logs to server terminal for easier debugging
      const sendServerLog = async (message: string, meta?: any, level = 'info') => {
        try {
          await fetch('/api/debug/client-logs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ level, message, meta }),
          });
        } catch (e) {
          // ignore failures
        }
      };

      // Precompute stake and participant side so both Open and P2P use same values
      const stakeWei = enrichedChallenge.stakeAmountWei?.toString() ||
                      enrichedChallenge.amount?.toString() ||
                      enrichedChallenge.stakeAmount?.toString();

      if (!stakeWei || stakeWei === '0' || stakeWei === 'NaN' || stakeWei === 'undefined') {
        throw new Error('Invalid stake amount. Please ensure the challenge has a valid stake.');
      }

      // Convert side string to enum value (0 = YES, 1 = NO)
      const participantSideValue = opponentSide === 'YES' ? 0 : 1;

      // For Open Challenges, perform the on-chain accept first, then notify server
      if (isOpenChallenge) {
        console.log('📡 Open Challenge - Performing on-chain accept, then notifying server...');
        sendServerLog('Open challenge flow started', { challengeId: enrichedChallenge.id, opponentSide }, 'info');

        // Use the same payment token fallback as P2P flow
        const paymentToken = enrichedChallenge.paymentTokenAddress || '0x036cbd53842c5426634e7929541ec2318f3dcf7e';

        // Call the blockchain hook to perform accept on-chain
        let onchainResult = null;
        try {
          onchainResult = await acceptP2PChallenge({
            challengeId: Number(enrichedChallenge.id),
            stakeAmount: stakeWei,
            paymentToken,
            pointsReward: '0',
            participantSide: participantSideValue,
          });

          console.log('✅ On-chain accept result:', onchainResult);
          sendServerLog('On-chain accept result', onchainResult, 'info');
          setTransactionHash(onchainResult.transactionHash || 'pending');

          // Inform backend that the open challenge was accepted with an on-chain tx
          const result = await apiRequest('POST', `/api/challenges/${enrichedChallenge.id}/accept-open`, {
            side: opponentSide,
            transactionHash: onchainResult.transactionHash,
          });
          sendServerLog('accept-open notified server', { challengeId: enrichedChallenge.id, tx: onchainResult.transactionHash }, 'info');
        } catch (err: any) {
          console.warn('On-chain accept failed:', err?.message || err);
          sendServerLog('On-chain accept failed', { err: String(err?.message || err), challengeId: enrichedChallenge.id }, 'warn');
          // If contract indicates this is not a P2P/on-chain challenge, fall back to server-only accept
            if (String(err?.message || '').includes('Not P2P challenge')) {
            console.log('ℹ️ Falling back to server accept-open (no on-chain record)');
            sendServerLog('Falling back to server accept-open', { challengeId: enrichedChallenge.id }, 'warn');
            toast({
              title: 'On-chain accept unavailable',
              description: 'This challenge has no matching on-chain record. Falling back to server-side accept.',
              variant: 'warning',
            });

            const result = await apiRequest('POST', `/api/challenges/${enrichedChallenge.id}/accept-open`, {
              side: opponentSide,
            });
            sendServerLog('accept-open fallback notified server', { challengeId: enrichedChallenge.id }, 'info');

            setTransactionHash(result.transactionHash || 'pending');
            setIsSubmitting(false);

              // Navigate to the challenge chat and close modal after fallback success
              setLocation(`/challenges/${enrichedChallenge.id}/chat`);
              setTimeout(() => {
                onSuccess?.();
                onClose();
              }, 1200);

              return;
          }

          // Otherwise rethrow
          throw err;
        }

        toast({
          title: '✅ Challenge Accepted!',
          description: `You picked ${opponentSide}. Stakes locked in escrow. Waiting for creator to confirm...`,
        });

        // Navigate to the challenge chat and close modal after success
        setLocation(`/challenges/${enrichedChallenge.id}/chat`);
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 1200);
      } else {
        // For Direct P2P Challenges, use the blockchain flow
        console.log('⛓️ P2P Challenge - Initiating blockchain transaction...');
        console.log('   Challenge ID:', enrichedChallenge.id);
        console.log('   Stake Amount (wei):', enrichedChallenge.stakeAmountWei);
        console.log('   Payment Token:', enrichedChallenge.paymentTokenAddress || '0x036cbd53842c5426634e7929541ec2318f3dcf7e');

        console.log('   Converted stake to:', stakeWei);

        console.log('   Challenge details for contract call:', {
          id: Number(enrichedChallenge.id),
          stakeAmount: stakeWei,
          paymentToken: enrichedChallenge.paymentTokenAddress || '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
          creatorSide: creatorSide,
          opponentSide: opponentSide
        });

        const result = await acceptP2PChallenge({
          challengeId: Number(enrichedChallenge.id),
          stakeAmount: stakeWei,
          paymentToken: enrichedChallenge.paymentTokenAddress || '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
          pointsReward: '0',
          participantSide: participantSideValue
        });

        console.log('✅ Transaction successful:', result);
        setTransactionHash(result.transactionHash);

        toast({
          title: '✅ Challenge Accepted!',
          description: `Stake confirmed on-chain. Waiting for creator to stake...`,
        });

        // Navigate to the challenge chat and close modal after success
        setLocation(`/challenges/${enrichedChallenge.id}/chat`);
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 1200);
      }
    } catch (err: any) {
      console.error('❌ Failed to accept challenge:', err);
      const errorMsg = err.message?.includes('user rejected')
        ? 'You cancelled the transaction'
        : err.message || 'Failed to accept challenge';
      
      setError(errorMsg);
      toast({
        title: '❌ Error',
        description: errorMsg,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        setError(null);
        onClose();
      }
    }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Accept Challenge</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {/* Challenger Info - Compact */}
          <div className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
            {challenger?.profileImageUrl ? (
              <img
                src={challenger.profileImageUrl}
                alt={challenger.firstName || 'Challenger'}
                className="w-8 h-8 rounded-full"
              />
            ) : (
              <UserAvatar userId={challenger?.id} username={challenger?.username} size={32} />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-xs">
                {challenger?.firstName || challenger?.username || 'Unknown'}
              </p>
              <div className="flex items-center gap-1.5">
                <p className="text-xs text-slate-500 truncate flex-1">
                  {enrichedChallenge.title}
                </p>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <img src={getTokenLogo()} alt={getTokenSymbol()} className="w-2.5 h-2.5" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{stakeInUSDC}</span>
                </div>
              </div>
            </div>
          </div>

          {/* For Open Challenges: Show creator's side choice and opponent's auto-assigned side */}
          {isOpenChallenge && (
            <>
              <div className="grid grid-cols-2 gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg border border-blue-200 dark:border-blue-900">
                <div className="text-center">
                  <p className="text-xs text-slate-500 mb-1">Creator Chose</p>
                  <div className={`text-xs font-bold p-1.5 rounded-md ${
                    creatorSide === 'YES' 
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' 
                      : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                  }`}>
                    {creatorSide === 'YES' ? '✓ YES' : '✗ NO'}
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-500 mb-1">You Pick</p>
                  <div className={`text-xs font-bold p-1.5 rounded-md ${
                    opponentSide === 'YES' 
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' 
                      : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                  }`}>
                    {opponentSide === 'YES' ? '✓ YES' : '✗ NO'}
                  </div>
                </div>
              </div>

              <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-900/30">
                <p className="text-xs text-blue-700 dark:text-blue-300 leading-tight">
                  Once accepted, both stakes lock in escrow. Challenge begins when creator confirms.
                </p>
              </div>
            </>
          )}

          {/* Challenge Details - Compact 3-column layout */}
          <div className="grid grid-cols-3 gap-1.5 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg">
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Category</p>
              <p className="text-lg">{getCategoryIcon(enrichedChallenge.category)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Your Stake</p>
              <div className="flex items-center gap-0.5">
                <img src={getTokenLogo()} alt={getTokenSymbol()} className="w-3 h-3" />
                <p className="text-xs font-bold">{stakeInUSDC}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-0.5">to win</p>
              <div className="flex items-center gap-0.5">
                <img src={getTokenLogo()} alt={getTokenSymbol()} className="w-3 h-3" />
                <p className="text-xs font-bold">{(Number(stakeInUSDC) * 2).toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Status Messages */}
          {error && (
            <div className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertCircle className="w-3 h-3 text-red-600 flex-shrink-0" />
              <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {transactionHash && (
            <div className="flex items-center gap-2 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <CheckCircle className="w-3 h-3 text-green-600 flex-shrink-0" />
              <p className="text-xs font-semibold text-green-700 dark:text-green-400">
                Challenge Accepted!
              </p>
            </div>
          )}

          {isRetrying && (
            <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <Loader className="w-3 h-3 text-blue-600 animate-spin flex-shrink-0" />
              <p className="text-xs text-blue-700 dark:text-blue-400">Processing...</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleAcceptChallenge}
              disabled={isSubmitting || isRetrying || !!transactionHash}
              className="w-full bg-[#ccff00] text-black hover:bg-[#b8e600] disabled:opacity-50 text-xs h-8 font-semibold"
            >
              {isSubmitting || isRetrying ? (
                <>
                  <Loader className="w-3 h-3 mr-1 animate-spin" />
                  Staking...
                </>
              ) : transactionHash ? '✓ Staked' : 'Stake'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
