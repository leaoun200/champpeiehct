import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { cn } from "@/lib/utils";
import { getGlobalChannel } from "@/lib/pusher";
import { MobileNavigation } from "@/components/MobileNavigation";
import { ChallengeCard } from "@/components/ChallengeCard";
import { ChallengeChat } from "@/components/ChallengeChat";
import { JoinChallengeModal } from "@/components/JoinChallengeModal";
import { ChallengePreviewCard } from "@/components/ChallengePreviewCard";
import { BantMap } from "@/components/BantMap";
import { Button } from "@/components/ui/button";
import CategoryBar from "@/components/CategoryBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

import { apiRequest } from "@/lib/queryClient";
import { useBlockchainChallenge, stakeAndCreateP2PChallengeClient } from '@/hooks/useBlockchainChallenge';
import { parseUnits } from 'ethers';
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { UserAvatar } from "@/components/UserAvatar";
import {
  MessageCircle,
  Clock,
  Trophy,
  TrendingUp,
  Zap,
  Users,
  Shield,
  Search,
  Check,
  X,
  ImagePlus,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

function ChallengeCardSkeleton() {
  return (
    <Card className="overflow-hidden min-h-[160px] bg-white dark:bg-slate-900 shadow-sm rounded-2xl animate-pulse border-0">
      <CardContent className="p-4 flex flex-col h-full space-y-4">
        <div className="flex items-center space-x-3">
          <Skeleton className="h-12 w-12 rounded-full bg-slate-200 dark:bg-slate-800" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-3/4 rounded-full bg-slate-200 dark:bg-slate-800" />
            <Skeleton className="h-3 w-1/2 rounded-full bg-slate-200 dark:bg-slate-800" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-full rounded-full bg-slate-100 dark:bg-slate-800/50" />
          <Skeleton className="h-3 w-5/6 rounded-full bg-slate-100 dark:bg-slate-800/50" />
        </div>
        <div className="pt-2 flex justify-between items-center">
          <Skeleton className="h-6 w-16 rounded-lg bg-slate-200 dark:bg-slate-800" />
          <Skeleton className="h-4 w-12 rounded-full bg-slate-100 dark:bg-slate-800/50" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function Challenges() {
  const { user, getAccessToken } = useAuth();
  const { createP2PChallenge } = useBlockchainChallenge(); // Get blockchain hook functions
  
  // Dev-time Vite env checks
  useEffect(() => {
    try {
      if ((import.meta as any).env?.DEV) {
        const required = [
          'VITE_BASE_TESTNET_RPC',
          'VITE_CHALLENGE_FACTORY_ADDRESS',
          'VITE_CHALLENGE_ESCROW_ADDRESS',
        ];
        const missing = required.filter((k) => !(import.meta as any).env?.[k]);
        if (missing.length) {
          console.warn('[DEV] Missing Vite env vars:', missing.join(', '));
        }
      }
    } catch (e) {
      // swallow in production
    }
  }, []);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [opponentSearchTerm, setOpponentSearchTerm] = useState("");
  const [selectedChallenge, setSelectedChallenge] = useState<any>(null);
  const [showChat, setShowChat] = useState(false);
  const [challengeStatusTab, setChallengeStatusTab] = useState<'all' | 'p2p' | 'house' | 'ended'>('all');
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [selectedTab, setSelectedTab] = useState<string>('featured');
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [preSelectedUser, setPreSelectedUser] = useState<any>(null);
  const [coverImagePreview, setCoverImagePreview] = useState<string | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [createFormData, setCreateFormData] = useState({
    title: '',
    description: '',
    category: 'trading',
    amount: 0 as number, // Allow decimals for ETH support
    challengeType: 'open', // 'open' or 'direct'
    opponentId: null as string | null,
    dueDate: '' as string, // ISO string
    paymentToken: 'USDC' as 'ETH' | 'USDT' | 'USDC', // Token selection
    side: 'YES' as 'YES' | 'NO', // Creator's chosen side
    coverImage: null as File | null,
    settlementMethod: 'voting' as 'voting' | 'uma',
  });

  const handleCoverImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const allowedTypes = ['image/gif', 'image/svg+xml', 'image/jpeg', 'image/png'];
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: 'Invalid format',
          description: 'Please use GIF, SVG, JPEG, or PNG format',
          variant: 'destructive',
        });
        return;
      }

      // Validate file size (max 2MB)
      const maxSize = 2 * 1024 * 1024; // 2MB
      if (file.size > maxSize) {
        toast({
          title: 'File too large',
          description: 'Image must be less than 2MB',
          variant: 'destructive',
        });
        return;
      }

      // For SVG and GIF, skip compression
      if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
        setCreateFormData({ ...createFormData, coverImage: file });
        const reader = new FileReader();
        reader.onloadend = () => {
          setCoverImagePreview(reader.result as string);
        };
        reader.readAsDataURL(file);
        return;
      }

      // Compress JPEG and PNG
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Resize if larger than 1000x1000
        if (width > 1000 || height > 1000) {
          const ratio = Math.min(1000 / width, 1000 / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (blob) {
                const compressedFile = new File([blob], file.name, {
                  type: 'image/jpeg',
                  lastModified: file.lastModified,
                });
                setCreateFormData({ ...createFormData, coverImage: compressedFile });
                const reader = new FileReader();
                reader.onloadend = () => {
                  setCoverImagePreview(reader.result as string);
                };
                reader.readAsDataURL(blob);
              }
            },
            'image/jpeg',
            0.8
          );
        }
      };
      img.src = URL.createObjectURL(file);
    }
  };

  // Listen for header search events dispatched from Navigation
  useEffect(() => {
    const onSearch = (e: any) => {
      const val = e?.detail ?? "";
      setSearchTerm(val);
    };
    const onOpen = () => setIsSearchOpen(true);

    window.addEventListener("challenges-search", onSearch as EventListener);
    window.addEventListener("open-challenges-search", onOpen as EventListener);

    return () => {
      window.removeEventListener("challenges-search", onSearch as EventListener);
      window.removeEventListener("open-challenges-search", onOpen as EventListener);
    };
  }, []);

  const { data: challenges = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/challenges"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/challenges/public", {
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error(`${response.status}: ${await response.json().then(e => e.message).catch(() => "Unknown error")}`);
        }
        const data = await response.json();
        // Ensure data is always an array
        if (!Array.isArray(data)) {
          console.error("Expected array from /api/challenges/public, got:", data);
          return [];
        }
        return data.map((challenge: any) => ({
          ...challenge,
          commentCount: challenge.commentCount ?? 0,
          participantCount: challenge.participantCount ?? 0,
        }));
      } catch (error: any) {
        console.error("Error fetching challenges:", error);
        return [];
      }
    },
    retry: false,
  });

  const { data: friends = [] as any[] } = useQuery({
    queryKey: ["/api/friends"],
    retry: false,
    enabled: !!user, // Only fetch when user is authenticated
  });

  const {
    data: allUsers = [] as any[],
    isLoading: usersLoading,
    error: usersError,
  } = useQuery({
    queryKey: ["/api/users/public"],
    retry: false,
    enabled: true, // allow public fetch for search/autocomplete
  });

  const { data: balance = 0 } = useQuery<any>({
    queryKey: ["/api/wallet/balance"],
    retry: false,
  });

  // Real-time listeners for challenge updates via Pusher
  useEffect(() => {
    const globalChannel = getGlobalChannel();
    
    // Listen for new challenge messages
    const handleNewMessage = (data: any) => {
      if (data.type === 'challenge_message' || data.challengeId) {
        queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
      }
    };

    // Listen for when users join/accept challenges
    const handleChallengeJoined = async (data: any) => {
      try {
        if (!(data?.type === 'challenge_joined' || data?.challengeId)) {
          return;
        }

        // Always refresh the challenge list
        queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });

        const challengeId = data.challengeId || data.challenge?.id || data.id;
        if (!challengeId) return;

        // If the payload indicates the challenge is now active, open the chat for participants
        const status = data.status || data.challenge?.status;
        if (status === 'active' && user) {
          try {
            const res = await fetch(`/api/challenges/${challengeId}`, { credentials: 'include' });
            if (!res.ok) return;
            const ch = await res.json();
            const isParticipant = ch && (ch.challengerId === user?.id || ch.challengedId === user?.id || ch.creatorId === user?.id);
            if (isParticipant) {
              setSelectedChallenge(ch);
              setShowChat(true);
            }
          } catch (e) {
            console.error('Failed to fetch challenge after join event', e);
          }
        }
      } catch (e) {
        console.error('Realtime challenge-joined handler error', e);
      }
    };

    globalChannel.bind('new-message', handleNewMessage);
    globalChannel.bind('challenge-joined', handleChallengeJoined);

    return () => {
      globalChannel.unbind('new-message', handleNewMessage);
      globalChannel.unbind('challenge-joined', handleChallengeJoined);
      globalChannel.unsubscribe();
    };
  }, [queryClient]);

  // Token address mapping for Base Sepolia (from environment template)
  // NOTE: Use address(0) for native ETH
  // NOTE: Using lowercase addresses to avoid ethers.js checksum validation issues
  const TOKEN_ADDRESSES: Record<'ETH' | 'USDT' | 'USDC', string> = {
    'ETH': '0x0000000000000000000000000000000000000000', // Native ETH (zero address)
    'USDT': '0x3c499c542cef5e3811e1192ce70d8cc7d307b653', // USDT on Base Sepolia
    'USDC': '0x036cbd53842c5426634e7929541ec2318f3dcf7e', // USDC on Base Sepolia
  };

  const createChallengeMutation = useMutation({
    mutationFn: async (formData: typeof createFormData) => {
      // Validate required fields
      if (!formData.title || formData.title.trim().length === 0) {
        throw new Error('Please enter a challenge title');
      }

      if (formData.amount <= 0) {
        throw new Error(`Please enter a valid amount (minimum 0.000001 ${formData.paymentToken})`);
      }

      if (formData.challengeType === 'direct' && !preSelectedUser) {
        throw new Error('Please select an opponent for direct challenges');
      }

      // Get selected token address
      const selectedTokenAddress = TOKEN_ADDRESSES[formData.paymentToken];

      console.log(`� Creating ${formData.paymentToken} challenge (ON-CHAIN + DB):`);
      console.log(`   Amount: ${formData.amount} ${formData.paymentToken}`);
      console.log(`   Type: ${formData.challengeType}`);
      console.log(`   Settlement: ${formData.settlementMethod}`);

      // NEW MODEL: Challenge creation is ON-CHAIN FIRST, then DB saved
      // User signs ONE transaction, challenge is created on-chain AND off-chain simultaneously
      toast({
        title: "Preparing Transaction",
        description: "Getting your wallet ready to sign...",
      });

      // STEP 1: Create on-chain FIRST - this will prompt user to sign
      let onchainTxHash = '';
      try {
        const stakeInWei = parseUnits(formData.amount.toString(), formData.paymentToken === 'ETH' ? 18 : 6).toString();
        
        console.log('📝 Initiating on-chain challenge creation...');
        console.log(`   Network: Base Sepolia (84532)`);
        console.log(`   Token: ${formData.paymentToken} (${selectedTokenAddress})`);
        console.log(`   Amount: ${formData.amount} (${stakeInWei} wei)`);
        console.log(`   Note: Wallet will be switched to Base Sepolia if needed`);
        console.log(`   Note: For testnet, use ETH. ERC20 tokens may not be deployed on testnet.`);
        
        
        if (formData.challengeType === 'open') {
          // For OPEN challenges, use stakeAndCreateP2PChallengeClient
          console.log('🌍 Creating OPEN challenge on-chain...');
          const result = await stakeAndCreateP2PChallengeClient({
            participantAddress: '0x0000000000000000000000000000000000000000', // Zero address for open
            stakeAmountWei: stakeInWei,
            paymentToken: selectedTokenAddress,
            pointsReward: '100',
            metadataURI: 'ipfs://bafytest',
          });
          if (!result || !result.transactionHash) {
            throw new Error('Transaction failed: No transaction hash returned from blockchain');
          }
          onchainTxHash = result.transactionHash;
          console.log(`✅ Open challenge created on-chain: ${onchainTxHash.slice(0,10)}...`);
        } else {
          // For DIRECT P2P challenges, use createP2PChallenge with specific opponent
          console.log('👥 Creating DIRECT P2P challenge on-chain...');
          if (!preSelectedUser?.walletAddress) {
            throw new Error('No opponent selected. Please select a friend to challenge.');
          }
          const result = await createP2PChallenge({
            opponentAddress: preSelectedUser.walletAddress,
            stakeAmount: stakeInWei,
            paymentToken: selectedTokenAddress,
            pointsReward: '100',
            metadataURI: 'ipfs://bafytest',
          });
          if (!result || !result.transactionHash) {
            throw new Error('Transaction failed: No transaction hash returned from blockchain');
          }
          onchainTxHash = result.transactionHash;
          console.log(`✅ P2P challenge created on-chain: ${onchainTxHash.slice(0,10)}...`);
        }
      } catch (e: any) {
        console.error('❌ On-chain creation failed:', e?.message || e);
        console.error('   Selected token:', selectedTokenAddress);
        console.error('   Amount:', formData.amount);
        // If on-chain fails, the whole creation fails - no fallback to off-chain
        throw new Error(`On-chain challenge creation failed: ${e?.message || e}`);
      }

      // STEP 2: Save to database with the transaction hash
      const requestBody = new FormData();
      requestBody.append('opponentId', formData.challengeType === 'direct' ? String(preSelectedUser?.id || '') : '');
      requestBody.append('title', formData.title);
      requestBody.append('description', formData.description);
      requestBody.append('stakeAmount', formData.amount.toString());
      requestBody.append('paymentToken', selectedTokenAddress);
      requestBody.append('dueDate', formData.dueDate || '');
      requestBody.append('metadataURI', 'ipfs://bafytest');
      requestBody.append('challengeType', formData.challengeType);
      requestBody.append('transactionHash', onchainTxHash); // NOW we have the tx hash!
      requestBody.append('side', formData.side);
      requestBody.append('settlementType', formData.settlementMethod || 'voting');
      if (formData.coverImage) {
        requestBody.append('coverImage', formData.coverImage);
      }

      const token = await getAccessToken();
      
      console.log(`\n🔐 About to call /api/challenges/create-p2p`);
      console.log(`   Token received: ${token ? 'Yes' : 'No'}`);
      console.log(`   Token (first 20 chars): ${token ? token.substring(0, 20) + '...' : 'NONE'}`);
      
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        console.log(`   ✓ Authorization header will be sent`);
      } else {
        // If running in development and a dev user id is provided via Vite env,
        // send the dev-bypass header so the local server accepts the request.
        const devUser = (import.meta as any).env?.VITE_DEV_USER_ID;
        if ((import.meta as any).env?.DEV && devUser) {
          headers['x-dev-user-id'] = String(devUser);
          console.log(`   ✓ Sending dev bypass header x-dev-user-id=${String(devUser).slice(0,8)}...`);
        } else {
          console.error(`   ❌ NO TOKEN - Request will likely fail with 401`);
        }
      }

      console.log(`   Sending request body with:`);
      console.log(`     - title: ${requestBody.get('title')}`);
      console.log(`     - stakeAmount: ${requestBody.get('stakeAmount')}`);
      console.log(`     - paymentToken: ${requestBody.get('paymentToken')}`);
      console.log(`     - opponentId: ${requestBody.get('opponentId')}`);
      console.log(`     - transactionHash: ${requestBody.get('transactionHash')}`);

      const response = await fetch('/api/challenges/create-p2p', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: requestBody,
      });

      console.log(`📡 API Response Status: ${response.status} ${response.statusText}`);
      console.log(`🔐 Auth header sent: ${token ? 'Yes' : 'No'}`);
      
      if (!response.ok) {
        let errorMessage = `API Error ${response.status}`;
        try {
          const error = await response.json();
          errorMessage = error.message || error.error || errorMessage;
          console.error(`❌ API Error Details:`, error);
        } catch (e) {
          const text = await response.text();
          console.error(`❌ API Error (non-JSON):`, text);
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log(`✅ Challenge created successfully:`, data);
      return data;
    },
    onSuccess: () => {
      toast({
        title: "✅ Challenge Created On-Chain!",
        description: "Your challenge is now live. Waiting for opponent to accept...",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
      setIsCreateDialogOpen(false);
      setAmountInput('');
      setCreateFormData({ title: '', description: '', category: 'trading', amount: 0, challengeType: 'open', opponentId: null, dueDate: '', paymentToken: 'USDC', side: 'YES', coverImage: null, settlementMethod: 'voting' });
      setCoverImagePreview(null);
      setPreSelectedUser(null);
    },
    onError: (error: Error) => {
      console.error('❌ Challenge creation failed:', error.message);
      
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        toast({
          title: "Unauthorized",
          description: "Please log in to create a challenge",
          variant: "destructive",
        });
        return;
      }
      
      if (error.message.includes('On-chain')) {
        let errorMsg = error.message;
        
        // Suggest ETH if token contract issues
        if (error.message.includes('token') || error.message.includes('Token') || error.message.includes('No contract code found')) {
          errorMsg += '\n\n💡 Tip: On testnet, use ETH instead. ERC20 tokens may not be deployed on Base Sepolia testnet.';
        }
        
        toast({
          title: "Blockchain Error",
          description: errorMsg,
          variant: "destructive",
        });
        return;
      }
      
      // Show ALL errors, not just some
      toast({
        title: "Challenge Creation Failed",
        description: error.message || 'Unknown error. Check browser console.',
        variant: "destructive",
      });
    },
  });

  const categories = [
    { id: "create", label: "Create", icon: "/assets/create.png", gradient: "from-green-400 to-emerald-500", isCreate: true, value: "create" },
    { id: "all", label: "All", icon: "/assets/versus.svg", gradient: "from-blue-400 to-purple-500", value: "all" },
    { id: "sports", label: "Sports", icon: "/assets/sportscon.svg", gradient: "from-green-400 to-blue-500", value: "sports" },
    { id: "gaming", label: "Gaming", icon: "/assets/gamingsvg.svg", gradient: "from-gray-400 to-gray-600", value: "gaming" },
    { id: "crypto", label: "Crypto", icon: "/assets/cryptosvg.svg", gradient: "from-yellow-400 to-orange-500", value: "crypto" },
    { id: "trading", label: "Trading", icon: "/assets/cryptosvg.svg", gradient: "from-yellow-400 to-orange-500", value: "trading" },
    { id: "music", label: "Music", icon: "/assets/musicsvg.svg", gradient: "from-blue-400 to-purple-500", value: "music" },
    { id: "entertainment", label: "Entertainment", icon: "/assets/popcorn.svg", gradient: "from-pink-400 to-red-500", value: "entertainment" },
    { id: "politics", label: "Politics", icon: "/assets/poltiii.svg", gradient: "from-green-400 to-teal-500", value: "politics" },
  ];

  const filteredChallenges = challenges.filter((challenge: any) => {
    const searchLower = searchTerm ? searchTerm.toLowerCase() : "";
    const matchesSearch =
      !searchTerm ||
      (challenge.title || "").toLowerCase().includes(searchLower) ||
      (challenge.description || "").toLowerCase().includes(searchLower) ||
      (challenge.category || "").toLowerCase().includes(searchLower) ||
      (challenge.challengerUser?.username || "")
        .toLowerCase()
        .includes(searchLower) ||
      (challenge.challengedUser?.username || "")
        .toLowerCase()
        .includes(searchLower);

    const matchesCategory =
      selectedCategory === "all" || challenge.category === selectedCategory;

    // Determine admin-created flag explicitly
    const isAdminCreated = challenge.adminCreated === true;

    // Check if challenge is ended
    const isEnded = challenge.status === 'completed' || (challenge.dueDate && new Date(challenge.dueDate).getTime() <= Date.now());

    // Filter by challenge status or category tab
    const matchesStatus =
      challengeStatusTab === 'all' ? true :
      challengeStatusTab === 'p2p' ? !isAdminCreated && !isEnded :
      challengeStatusTab === 'house' ? isAdminCreated && !isEnded :
      challengeStatusTab === 'ended' ? isEnded :
      true;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const filteredUsers = Array.isArray(allUsers) ? (allUsers as any[]).filter((u: any) => {
    if (!opponentSearchTerm || u.id === user?.id) return false;
    if (u.isAdmin) return false;

    // Normalize common user input mistakes: allow 'ox' (letter o) to match '0x' (zero-x) wallet prefixes
    const normalizedInput = opponentSearchTerm.replace(/^o(?=x)/i, '0').trim().toLowerCase();

    const firstName = (u.firstName || "").toLowerCase();
    const lastName = (u.lastName || "").toLowerCase();
    const username = (u.username || "").toLowerCase();
    const fullName = `${firstName} ${lastName}`.trim().toLowerCase();
    const walletAddress = (u.primaryWalletAddress || "").toLowerCase();
    const email = (u.email || "").toLowerCase();
    const displayName = (u.displayName || "").toLowerCase();
    const handle = (u.handle || "").toLowerCase();
    const did = (u.did || "").toLowerCase();

    return (
      firstName.includes(normalizedInput) ||
      lastName.includes(normalizedInput) ||
      username.includes(normalizedInput) ||
      fullName.includes(normalizedInput) ||
      walletAddress.includes(normalizedInput) ||
      email.includes(normalizedInput) ||
      displayName.includes(normalizedInput) ||
      handle.includes(normalizedInput) ||
      did.includes(normalizedInput) ||
      String(u.id).includes(normalizedInput)
    );
  }) : [];

  useEffect(() => {
    try {
      console.log('[DEBUG] Opponent search term:', opponentSearchTerm);
      console.log('[DEBUG] All users count:', Array.isArray(allUsers) ? allUsers.length : 0);
      console.log('[DEBUG] Filtered users count:', filteredUsers.length);
    } catch (e) {
      console.error('[DEBUG] Failed to log opponent search debug info', e);
    }
  }, [opponentSearchTerm, allUsers, filteredUsers.length]);

  

  const pendingChallenges = filteredChallenges.filter(
    (c: any) => c.status === "pending" && !c.adminCreated && (c.challengerId === user?.id || c.challengedId === user?.id),
  );
  const activeChallenges = filteredChallenges.filter(
    (c: any) => c.status === "active" && !c.adminCreated,
  );
  const awaitingResolutionChallenges = filteredChallenges.filter(
    (c: any) => c.status === "pending_admin" && c.adminCreated && (c.challengerId === user?.id || c.challengedId === user?.id || c.creatorId === user?.id),
  );
  const completedChallenges = filteredChallenges.filter(
    (c: any) => c.status === "completed" && !c.adminCreated,
  );
  const featuredChallenges = filteredChallenges.filter(
    (c: any) => c.adminCreated && c.status !== "pending_admin",
  );

  // Validate selected tab - reset to featured if current tab is hidden
  useEffect(() => {
    const isTabVisible = 
      selectedTab === 'featured' || 
      selectedTab === 'active' ||
      selectedTab === 'completed' ||
      (user && selectedTab === 'pending' && pendingChallenges.length > 0) ||
      (user && selectedTab === 'awaiting_resolution' && awaitingResolutionChallenges.length > 0);
    
    if (!isTabVisible) {
      setSelectedTab('featured');
    }
  }, [selectedTab, user, pendingChallenges.length, awaitingResolutionChallenges.length]);

  const onSubmit = (data: any) => {
    const amount = parseFloat(data.amount);
    const currentBalance =
      balance && typeof balance === "object" ? (balance as any).balance : balance;

    if (amount > currentBalance) {
      toast({
        title: "Insufficient Balance",
        description: "You don't have enough funds to create this challenge.",
        variant: "destructive",
      });
      return;
    }

    createChallengeMutation.mutate(data);
  };

  const handleChallengeClick = (challenge: any) => {
    // Navigate to the challenge activity page instead of opening the modal.
    // This allows users to view the activity page even if they're not a participant.
    window.location.href = `/challenges/${challenge.id}/activity`;
  };

  const handleJoin = (challenge: any) => {
    setSelectedChallenge(challenge);
    setShowJoinModal(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-500";
      case "active":
        return "bg-green-500";
      case "completed":
        return "bg-blue-500";
      case "disputed":
        return "bg-red-500";
      case "cancelled":
        return "bg-gray-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
        return Clock;
      case "active":
        return Zap;
      case "completed":
        return Trophy;
      case "disputed":
        return Shield;
      default:
        return Clock;
    }
  };

  // Handle authentication errors
  useEffect(() => {
    if (usersError && isUnauthorizedError(usersError as Error)) {
      toast({
        title: "Session Expired",
        description: "Please log in again to continue.",
        variant: "destructive",
      });
    }
  }, [usersError, toast]);

  // Handle open create dialog event from mobile nav
  useEffect(() => {
    const handleOpenCreateDialog = () => {
      setIsCreateDialogOpen(true);
    };

    window.addEventListener("open-create-dialog", handleOpenCreateDialog);
    return () => {
      window.removeEventListener("open-create-dialog", handleOpenCreateDialog);
    };
  }, []);

  if (!user) {
    // Allow unauthenticated users to view challenges but show login prompts for actions
  }

  // Debug logging for Ended tab
  useEffect(() => {
    if (challengeStatusTab === 'ended') {
      console.log('🔴 ENDED TAB - Challenges shown:');
      filteredChallenges.forEach(c => {
        const isEnded = c.status === 'completed' || (c.dueDate && new Date(c.dueDate).getTime() <= Date.now());
        console.log(`  Challenge #${c.id}: status=${c.status}, dueDate=${c.dueDate}, isEnded=${isEnded}, completed=${c.status === 'completed'}`);
      });
    }
  }, [challengeStatusTab, filteredChallenges]);

  const sortedChallenges = [...filteredChallenges].sort((a: any, b: any) => {
    // For "all" tab, sort by newest first
    if (challengeStatusTab === 'all') {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }

    // For other tabs (p2p, house), use priority-based sorting
    // Priority 0: Pinned challenges first
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;

    // Priority 1: Pending (Action Required)
    const aIsPending = a.status === 'pending' && !a.adminCreated && (a.challengerId === user?.id || a.challengedId === user?.id);
    const bIsPending = b.status === 'pending' && !b.adminCreated && (b.challengerId === user?.id || b.challengedId === user?.id);
    if (aIsPending && !bIsPending) return -1;
    if (!aIsPending && bIsPending) return 1;

    // Priority 2: Active/Live
    const aIsActive = a.status === 'active';
    const bIsActive = b.status === 'active';
    if (aIsActive && !bIsActive) return -1;
    if (!aIsActive && bIsActive) return 1;

    // Priority 3: Featured/Open (Admin created matches)
    const aIsOpen = a.status === 'open' && a.adminCreated;
    const bIsOpen = b.status === 'open' && b.adminCreated;
    if (aIsOpen && !bIsOpen) return -1;
    if (!aIsOpen && bIsOpen) return 1;

    // Priority 4: Awaiting Resolution
    const aIsAwaiting = a.status === 'pending_admin';
    const bIsAwaiting = b.status === 'pending_admin';
    if (aIsAwaiting && !bIsAwaiting) return -1;
    if (!aIsAwaiting && bIsAwaiting) return 1;

    // Default: Newest first
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 theme-transition pb-[50px]">
      <div className="max-w-7xl mx-auto px-3 md:px-4 sm:px-6 lg:px-8 py-2 md:py-4">
        <CategoryBar
          categories={categories}
          selectedCategory={selectedCategory}
          onSelect={(id) => {
            if (id === 'create') {
              setIsCreateDialogOpen(true);
              return;
            }
            setSelectedCategory(id);
          }}
        />

        {/* Challenge Status Tabs */}
        <div className="overflow-x-auto scrollbar-hide -mx-3 px-3 pb-1 md:flex md:justify-center">
          <Tabs 
            defaultValue="all" 
            value={challengeStatusTab} 
            onValueChange={(val) => setChallengeStatusTab(val as any)} 
            className="w-full md:w-auto"
          >
            <TabsList className="inline-flex w-fit h-8 border-0 shadow-none bg-transparent gap-1 items-center">
              <TabsTrigger 
                value="all" 
                className="text-xs px-3 py-1.5 rounded-full data-[state=active]:bg-[#7440ff] data-[state=active]:text-white whitespace-nowrap bg-white dark:bg-slate-800 transition-all h-auto font-semibold"
              >
                All
              </TabsTrigger>
              <TabsTrigger 
                value="p2p" 
                className="text-xs px-3 py-1.5 rounded-full data-[state=active]:bg-[#7440ff] data-[state=active]:text-white whitespace-nowrap bg-white dark:bg-slate-800 transition-all h-auto font-semibold"
              >
                P2P
              </TabsTrigger>
              <TabsTrigger 
                value="house" 
                className="text-xs px-3 py-1.5 rounded-full data-[state=active]:bg-[#7440ff] data-[state=active]:text-white whitespace-nowrap bg-white dark:bg-slate-800 transition-all h-auto font-semibold"
              >
                HOUSE
              </TabsTrigger>
              <TabsTrigger 
                value="ended" 
                className="text-xs px-3 py-1.5 rounded-full data-[state=active]:bg-[#7440ff] data-[state=active]:text-white whitespace-nowrap bg-white dark:bg-slate-800 transition-all h-auto font-semibold"
              >
                Ended
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="mt-4">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-1">
              {[...Array(6)].map((_, i) => (
                <ChallengeCardSkeleton key={i} />
              ))}
            </div>
          ) : sortedChallenges.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-1">
              {sortedChallenges.map((challenge) => (
                <ChallengeCard
                  key={challenge.id}
                  challenge={challenge}
                  onChatClick={handleChallengeClick}
                  onJoin={handleJoin}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-20">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 mb-4">
                <img 
                  src="/assets/bantahsearch.png" 
                  alt="No challenges" 
                  className="w-8 h-8 object-contain"
                />
              </div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">No challenges found</h3>
              <p className="text-slate-500 dark:text-slate-400">Try adjusting your search or category filters</p>
            </div>
          )}
        </div>

        <Dialog
          open={isCreateDialogOpen}
          onOpenChange={(open) => {
            setIsCreateDialogOpen(open);
            if (!open) {
              setPreSelectedUser(null);
            }
          }}
        >
      <DialogContent className="max-w-[360px] p-0 overflow-hidden border-none shadow-2xl rounded-2xl bg-white dark:bg-slate-900">
        <div className="max-h-[90vh] overflow-y-auto scrollbar-hide"
          style={{
            scrollbarWidth: 'thin',
            scrollbarColor: '#e2e8f0 transparent'
          }}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4">
            <DialogHeader className="pb-0">
              <DialogTitle className="text-sm font-bold text-center">Create Challenge</DialogTitle>
            </DialogHeader>
          </div>

          <div className="p-4 space-y-3">
            {/* Challenge Type Selector */}
            <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg -mx-4 px-4">
              <Button
                variant="ghost"
                className={cn(
                  "flex-1 px-3 py-2 text-sm font-semibold rounded-md transition-all",
                  createFormData.challengeType === 'open'
                    ? "bg-[#7440FF] text-white hover:bg-[#6333DD]"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700"
                )}
                onClick={() => setCreateFormData({ ...createFormData, challengeType: 'open' })}
              >
                Open Challenge
              </Button>
              <Button
                variant="ghost"
                className={cn(
                  "flex-1 px-3 py-2 text-sm font-semibold rounded-md transition-all",
                  createFormData.challengeType === 'direct'
                    ? "bg-[#7440FF] text-white hover:bg-[#6333DD]"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700"
                )}
                onClick={() => setCreateFormData({ ...createFormData, challengeType: 'direct' })}
              >
                P2P Challenge
              </Button>
            </div>

            {/* Challenge Preview Box */}
            <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-lg space-y-1">
              {createFormData.title && (
                <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">
                  {createFormData.title}
                </p>
              )}
            </div>

            {/* Title Input */}
            <div>
              <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block mb-1">Challenge Title *</label>
              <Input
                placeholder="e.g., Will Bitcoin hit $100,000 before Feb 22?"
                className="rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-[#7440FF] h-8 text-xs placeholder:text-slate-400 dark:placeholder:text-slate-500"
                value={createFormData.title}
                onChange={(e) => setCreateFormData({ ...createFormData, title: e.target.value })}
              />
            </div>

            {/* Category & Date Row */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block mb-1">Category *</label>
                <Select
                  value={createFormData.category}
                  onValueChange={(val) => setCreateFormData({ ...createFormData, category: val })}
                >
                  <SelectTrigger className="rounded-lg bg-white dark:bg-slate-800 h-8 text-xs border-0 outline-none focus:outline-none">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg bg-white dark:bg-slate-900 shadow-xl border-0">
                    <SelectItem value="general">📌 General</SelectItem>
                    <SelectItem value="gaming">🎮 Gaming</SelectItem>
                    <SelectItem value="crypto">💰 Crypto</SelectItem>
                    <SelectItem value="trading">📈 Trading</SelectItem>
                    <SelectItem value="music">🎵 Music</SelectItem>
                    <SelectItem value="entertainment">🎬 Entertainment</SelectItem>
                    <SelectItem value="politics">🏛️ Politics</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block mb-1">Resolution Date *</label>
                <Input
                  type="datetime-local"
                  className="rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-[#7440FF] h-8 text-xs border-0 outline-none focus:outline-none cursor-pointer"
                  value={createFormData.dueDate}
                  onChange={(e) => setCreateFormData({ ...createFormData, dueDate: e.target.value })}
                  min={new Date().toISOString().slice(0, 16)}
                />
              </div>
            </div>

            {/* Position Section */}
            <div>
              <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block mb-1.5">Position *</label>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  type="button"
                  onClick={() => setCreateFormData({ ...createFormData, side: 'YES' })}
                  className={cn(
                    "flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-all font-bold",
                    createFormData.side === 'YES' 
                      ? "bg-green-500/10 border-green-500 text-green-600 dark:text-green-400" 
                      : "border-slate-100 dark:border-slate-800 text-slate-400"
                  )}
                >
                  <Check className="w-4 h-4" />
                  SIDE: YES
                </button>
                <button
                  type="button"
                  onClick={() => setCreateFormData({ ...createFormData, side: 'NO' })}
                  className={cn(
                    "flex items-center justify-center gap-2 py-3 rounded-xl border-2 transition-all font-bold",
                    createFormData.side === 'NO' 
                      ? "bg-red-500/10 border-red-500 text-red-600 dark:text-red-400" 
                      : "border-slate-100 dark:border-slate-800 text-slate-400"
                  )}
                >
                  <X className="w-4 h-4" />
                  SIDE: NO
                </button>
              </div>
            </div>

            {/* Settlement Method - show once title entered and side chosen */}
            {createFormData.title.trim().length > 0 && createFormData.side && (
              <div className="mt-1">
                <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block mb-1">Settlement Method</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateFormData({ ...createFormData, settlementMethod: 'voting' })}
                    className={cn(
                      "flex-1 text-xs px-2 py-2 rounded-lg border transition-all",
                      createFormData.settlementMethod === 'voting'
                        ? 'bg-[#0ea5a2]/10 border-teal-400 text-teal-600 font-semibold'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600'
                    )}
                  >
                    Voting
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateFormData({ ...createFormData, settlementMethod: 'uma' })}
                    className={cn(
                      "flex-1 text-xs px-2 py-2 rounded-lg border transition-all",
                      createFormData.settlementMethod === 'uma'
                        ? 'bg-[#7440FF]/10 border-purple-500 text-purple-600 font-semibold'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600'
                    )}
                  >
                    UMA Protocol
                  </button>
                </div>
              </div>
            )}

            {/* Bet Amount Section */}
            <div>
              <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400 block mb-1.5">Stake *</label>
              
              {/* Amount Input */}
              <div className="flex gap-2 mb-2">
                <div className="flex-1 relative">
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-[#7440FF] h-8 text-sm font-semibold pr-16 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                    value={amountInput}
                    onChange={(e) => {
                      const inputValue = e.target.value;
                      setAmountInput(inputValue);
                      const val = parseFloat(inputValue);
                      setCreateFormData({ ...createFormData, amount: isNaN(val) ? 0 : val });
                    }}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-600 dark:text-slate-400">
                    {createFormData.paymentToken}
                  </span>
                </div>
                <Select
                  value={createFormData.paymentToken}
                  onValueChange={(val) => setCreateFormData({ ...createFormData, paymentToken: val as 'ETH' | 'USDT' | 'USDC' })}
                >
                  <SelectTrigger className="w-28 rounded-lg bg-white dark:bg-slate-800 h-8 text-xs border-0 outline-none focus:outline-none flex items-center gap-1 px-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg bg-white dark:bg-slate-900 border-0">
                    <SelectItem value="USDC">
                      <div className="flex items-center gap-2">
                        <img src="/assets/usd-coin-usdc-logo.svg" alt="USDC" className="w-4 h-4" />
                        <span>USDC</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="ETH">
                      <div className="flex items-center gap-2">
                        <img src="/assets/ethereum-eth-logo.svg" alt="ETH" className="w-4 h-4" />
                        <span>ETH</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="USDT">
                      <div className="flex items-center gap-2">
                        <img src="/assets/usd-coin-usdc-logo.svg" alt="USDT" className="w-4 h-4" />
                        <span>USDT</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Quick Percentage Buttons */}
              <div className="grid grid-cols-4 gap-1.5 mb-1.5">
                {['25%', '50%', '75%', 'Max'].map((label) => (
                  <Button
                    key={label}
                    variant="outline"
                    className="text-[10px] font-semibold h-7 rounded-lg border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => {
                      // Calculate percentage based on user balance or set fixed
                      const percentage = label === 'Max' ? 100 : parseInt(label);
                      const newAmount = (percentage / 100) * 10; // Example: assuming 10 unit balance
                      setAmountInput(newAmount.toString());
                      setCreateFormData({ ...createFormData, amount: newAmount });
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Outcome Section */}
            {createFormData.amount > 0 && (
              <div className="bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-lg space-y-2">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Outcome</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-2 rounded-lg">
                    <p className="text-[10px] font-semibold text-green-700 dark:text-green-400 mb-0.5">If {createFormData.side} wins:</p>
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      +{(createFormData.amount).toFixed(4)}
                    </p>
                    <p className="text-[9px] text-green-600 dark:text-green-400">
                      Profit
                    </p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-2 rounded-lg">
                    <p className="text-[10px] font-semibold text-red-700 dark:text-red-400 mb-0.5">If {createFormData.side} loses:</p>
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      -{(createFormData.amount).toFixed(4)}
                    </p>
                    <p className="text-[9px] text-red-600 dark:text-red-400">
                      Loss
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Event Banner Upload */}
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1"></label>
              <div className="flex items-center justify-center w-full">
                <label className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  <div className="flex flex-col items-center justify-center">
                    <ImagePlus className="w-4 h-4 text-slate-400" />
                    <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">upload event banner</p>
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    accept=".gif,.svg,.jpg,.jpeg,.png,image/gif,image/svg+xml,image/jpeg,image/png"
                    onChange={handleCoverImageChange}
                  />
                </label>
              </div>
              {coverImagePreview && (
                <div className="mt-1.5 flex items-center justify-center">
                  <img
                    src={coverImagePreview}
                    alt="Cover preview"
                    className="max-h-16 max-w-16 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
                  />
                </div>
              )}
            </div>

            {/* Opponent Search - Direct Only */}
            {createFormData.challengeType === 'direct' && (
              <div className="animate-in fade-in space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">Select Opponent *</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                  <Input
                    placeholder="Search username or address"
                    className="rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-[#7440FF] h-8 pl-9 text-xs"
                    value={opponentSearchTerm}
                    onChange={(e) => setOpponentSearchTerm(e.target.value)}
                  />
                </div>
                
                {opponentSearchTerm && filteredUsers.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg divide-y divide-slate-100 dark:divide-slate-700">
                    {filteredUsers.map((u: any) => (
                      <button
                        key={u.id}
                        className={cn(
                          "w-full flex items-center gap-2 p-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm",
                          preSelectedUser?.id === u.id && "bg-[#7440FF]/10 dark:bg-[#7440FF]/5"
                        )}
                        onClick={() => {
                              console.log('[DEBUG] Opponent selected:', { id: u.id, username: u.username });
                              setPreSelectedUser(u);
                              setOpponentSearchTerm("");
                            }}
                      >
                        <UserAvatar userId={u.id} username={u.username} src={u.profileImageUrl || u.profileImage || u.avatarUrl} className="h-5 w-5" />
                        <div className="flex flex-col flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-slate-100 text-xs">@{u.username}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {preSelectedUser && (
                  <div className="flex items-center gap-1.5 p-2 rounded-lg bg-[#7440FF]/10 dark:bg-[#7440FF]/5 border border-[#7440FF]/20 text-xs">
                    <UserAvatar userId={preSelectedUser.id} username={preSelectedUser.username} src={preSelectedUser.profileImageUrl || preSelectedUser.profileImage || preSelectedUser.avatarUrl} className="h-5 w-5" />
                    <p className="flex-1 font-semibold text-xs">@{preSelectedUser.username}</p>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-5 w-5 text-slate-400 hover:text-red-500"
                      onClick={() => setPreSelectedUser(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer with Action Button */}
          <div className="sticky bottom-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-3">
            <Button
              className="w-full h-10 rounded-lg bg-[#7440FF] text-white font-bold text-sm hover:bg-[#6333DD] disabled:opacity-50 transition-all active:scale-[0.98]"
              disabled={createChallengeMutation.isPending || !createFormData.title || createFormData.amount <= 0 || (createFormData.challengeType === 'direct' && !preSelectedUser)}
              onClick={() => {
                if (!createFormData.amount || createFormData.amount <= 0) {
                  toast({
                    title: 'Invalid Amount',
                    description: `Please enter a valid amount greater than 0`,
                    variant: 'destructive',
                  });
                  return;
                }
                createChallengeMutation.mutate(createFormData);
              }}
            >
              {createChallengeMutation.isPending ? "Creating..." : `Create ${createFormData.side}`}
            </Button>
          </div>
        </div>
      </DialogContent>
        </Dialog>

        {/* Search results and other content below the feed */}
        {searchTerm && (
          <div className="mt-8 space-y-6">
             {/* Search content... */}
          </div>
        )}
      </div>

      {/* Challenge Chat Dialog */}
      {showChat && selectedChallenge && (
        <Dialog open={showChat} onOpenChange={setShowChat}>
          <DialogContent className="sm:max-w-4xl max-h-[80vh] p-0">
            <ChallengeChat
              challenge={selectedChallenge}
              onClose={() => setShowChat(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Join Challenge Modal (for admin-created betting challenges) */}
      {showJoinModal && selectedChallenge && (
        <JoinChallengeModal
          isOpen={showJoinModal}
          onClose={() => setShowJoinModal(false)}
          challenge={selectedChallenge}
          userBalance={balance && typeof balance === "object" ? (balance as any).balance : (typeof balance === 'number' ? balance : 0)}
        />
      )}

      <MobileNavigation onCreateClick={() => setIsCreateDialogOpen(true)} />
    </div>
  );
}
