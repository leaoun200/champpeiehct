import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useBlockchainChallenge } from "@/hooks/useBlockchainChallenge";
import { stakeAndCreateP2PChallengeClient } from '@/hooks/useBlockchainChallenge';
import { parseUnits } from 'ethers';
import { AcceptChallengeModal } from "@/components/AcceptChallengeModal";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ChallengePreviewCard } from "@/components/ChallengePreviewCard";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { toast } from "@/hooks/use-toast";
import { MobileNavigation } from "@/components/MobileNavigation";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { zodResolver } from "@hookform/resolvers/zod";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";
import { useForm } from "react-hook-form";
import { z } from "zod";

const createChallengeSchema = z.object({
  challenged: z.string().min(1, "Challenged user required"),
  title: z.string().min(1, "Title required"),
  description: z.string().optional(),
  category: z.string().min(1, "Category required"),
  amount: z.string().min(1, "Amount required"),
  dueDate: z.string().min(1, "Due date required"),
  paymentToken: z.enum(['ETH', 'USDT', 'USDC']).default('ETH'),
});

function FriendUserCardSkeleton() {
  return (
    <Card className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
      <CardContent className="p-2 md:p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 flex-1">
            <Skeleton className="h-9 w-9 rounded-full bg-slate-200 dark:bg-slate-700" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
              <Skeleton className="h-2.5 w-24 rounded bg-slate-100 dark:bg-slate-700/50" />
            </div>
          </div>
          <div className="flex items-center space-x-1.5">
            <Skeleton className="h-8 w-16 rounded-lg bg-slate-200 dark:bg-slate-700" />
            <Skeleton className="h-8 w-20 rounded-lg bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FriendRequestCardSkeleton() {
  return (
    <Card className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3 flex-1">
            <Skeleton className="h-12 w-12 rounded-full bg-slate-200 dark:bg-slate-700" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
              <Skeleton className="h-3 w-40 rounded bg-slate-100 dark:bg-slate-700/50" />
            </div>
          </div>
          <div className="flex space-x-2">
            <Skeleton className="h-10 w-20 rounded-lg bg-slate-200 dark:bg-slate-700" />
            <Skeleton className="h-10 w-20 rounded-lg bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AllUserCardSkeleton() {
  return (
    <Card className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
      <CardContent className="p-2 md:p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 flex-1">
            <Skeleton className="h-9 w-9 rounded-full bg-slate-200 dark:bg-slate-700" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
              <Skeleton className="h-2.5 w-24 rounded bg-slate-100 dark:bg-slate-700/50" />
            </div>
          </div>
          <div className="flex items-center space-x-1.5">
            <Skeleton className="h-8 w-20 rounded-lg bg-slate-200 dark:bg-slate-700" />
            <Skeleton className="h-8 w-20 rounded-lg bg-slate-200 dark:bg-slate-700" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Friends() {
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const [searchTerm, setSearchTerm] = useState("");
    const [friendEmail, setFriendEmail] = useState("");
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [showChallengeModal, setShowChallengeModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [pendingFriendId, setPendingFriendId] = useState<string | null>(null);
    const [showAcceptModal, setShowAcceptModal] = useState(false);
    const [selectedChallengeToAccept, setSelectedChallengeToAccept] = useState<any>(null);

  const form = useForm<z.infer<typeof createChallengeSchema>>({
    resolver: zodResolver(createChallengeSchema),
    defaultValues: {
      challenged: "",
      title: "",
      description: "",
      category: "",
      amount: "",
      dueDate: "",
      paymentToken: "ETH",
    },
  });

  const categories = [
    { value: "gaming", label: "Gaming", icon: "🎮" },
    { value: "sports", label: "Sports", icon: "⚽" },
    { value: "trading", label: "Trading", icon: "📈" },
    { value: "fitness", label: "Fitness", icon: "🏃" },
    { value: "skill", label: "Skill", icon: "🧠" },
    { value: "other", label: "Other", icon: "🎯" },
  ];

  // Fetch both accepted friends and pending requests
  const { data: friendsData = {}, isLoading: friendsLoading } = useQuery({
    queryKey: ["/api/friends"],
    retry: false,
  });

  const { data: requestsData = {}, isLoading: requestsLoading } = useQuery({
    queryKey: ["/api/friends/requests"],
    retry: false,
  });

  const { data: sentRequestsData = {}, isLoading: sentRequestsLoading } = useQuery({
    queryKey: ["/api/friends/sent-requests"],
    retry: false,
  });

  // Combine all friendship-related data
  const friends = Array.isArray(friendsData) 
    ? friendsData 
    : (friendsData as any)?.friends || [];

  const requestsList = Array.isArray(requestsData) 
    ? requestsData 
    : (requestsData as any)?.requests || [];

  const sentRequestsList = Array.isArray(sentRequestsData) 
    ? sentRequestsData 
    : (sentRequestsData as any)?.requests || [];

  const isLoading = friendsLoading || requestsLoading || sentRequestsLoading;

  const sendFriendRequestMutation = useMutation({
    mutationFn: async (addresseeId: string) => {
      await apiRequest("POST", `/api/friends/request/${addresseeId}`);
    },
    onSuccess: () => {
      toast({
        title: "Friend Request Sent",
        description: "Your friend request has been sent!",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/friends"] });
      queryClient.invalidateQueries({ queryKey: ["/api/friends/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/friends/sent-requests"] });
      setIsAddDialogOpen(false);
      setFriendEmail("");
      setPendingFriendId(null);
    },
    onError: (error: Error) => {
      setPendingFriendId(null);
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const acceptFriendRequestMutation = useMutation({
    mutationFn: async (requestId: number) => {
      await apiRequest("POST", `/api/friends/accept/${requestId}`);
    },
    onSuccess: () => {
      toast({
        title: "Friend Request Accepted",
        description: "You are now friends!",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/friends"] });
      queryClient.invalidateQueries({ queryKey: ["/api/friends/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/friends/sent-requests"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const declineFriendRequestMutation = useMutation({
    mutationFn: async (requestId: number) => {
      await apiRequest("POST", `/api/friends/decline/${requestId}`);
    },
    onSuccess: () => {
      toast({
        title: "Friend Request Declined",
        description: "The request has been removed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/friends/requests"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { createP2PChallenge } = useBlockchainChallenge();

  // Token address mapping for Base Sepolia (using lowercase to avoid checksum issues)
  const TOKEN_ADDRESSES: Record<'ETH' | 'USDT' | 'USDC', string> = {
    'ETH': '0x4200000000000000000000000000000000000006', // Wrapped ETH on Base
    'USDT': '0x3c499c542cef5e3811e1192ce70d8cc7d307b653', // USDT on Base Sepolia
     'USDC': '0x036cbd53842c5426634e7929541ec2318f3dcf7e', // USDC on Base Sepolia
  };

  const createChallengeMutation = useMutation({
    mutationFn: async (data: z.infer<typeof createChallengeSchema>) => {
      // Get selected token address
      const selectedTokenAddress = TOKEN_ADDRESSES[data.paymentToken];
      
      // Step 1: Store challenge in database
      const challengeData = {
        opponentId: selectedUser?.id || data.challenged,
        title: data.title,
        description: data.description,
        stakeAmount: data.amount,
        paymentToken: selectedTokenAddress,
        metadataURI: 'ipfs://bafytest',
      };
      
      const response = await apiRequest("POST", "/api/challenges/create-p2p", challengeData);
      
      // Step 2: Sign and submit to blockchain
      // Convert amount to wei based on token decimals: ETH = 18 decimals, USDC/USDT = 6 decimals
      const decimals = data.paymentToken === 'ETH' ? 1e18 : 1e6;
      const stakeWei = String(Math.floor(parseFloat(data.amount) * decimals));
      const pointsReward = "500"; // Fixed points for now
      
      toast({
        title: "Challenge Created",
        description: "Preparing blockchain transaction...",
      });

      try {
        const participantAddress = selectedUser?.primaryWalletAddress || selectedUser?.id || data.challenged;
        const tx = await stakeAndCreateP2PChallengeClient({
          participantAddress,
          stakeAmountWei: stakeWei,
          paymentToken: selectedTokenAddress,
          pointsReward,
          metadataURI: 'ipfs://bafytest',
        });
        console.log('Creator stake+create tx:', tx.transactionHash);
        // If we have a tx hash and the server returned a challengeId, attach the tx to the challenge
        try {
          const challengeId = response?.challengeId || response?.id;
          if (tx?.transactionHash && challengeId) {
            const txHash = typeof tx.transactionHash === 'string' ? tx.transactionHash.trim() : String(tx.transactionHash);
            if (/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
              await apiRequest('POST', `/api/challenges/${challengeId}/creator-confirm-stake`, { transactionHash: txHash });
              console.log(`Attached tx to challenge ${challengeId}: ${txHash}`);
            } else {
              console.warn('Received non-standard tx hash, skipping attach:', txHash);
            }
          }
        } catch (attachErr) {
          console.warn('Failed to attach transactionHash to challenge:', attachErr);
        }
      } catch (blockchainError: any) {
        console.warn('Blockchain submission failed, but challenge is stored in DB:', blockchainError);
        // Don't throw - challenge is already in DB, user can retry signing later
      }
      
      return response;
    },
    onSuccess: () => {
      toast({
        title: "Challenge Sent!",
        description: `Challenge sent to ${selectedUser?.firstName || selectedUser?.username}`,
      });
      setShowChallengeModal(false);
      setSelectedUser(null);
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
        return;
      }
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ["/api/users"],
    retry: false,
    select: (data) => {
      // Ensure data is always an array
      return Array.isArray(data) ? data : [];
    },
  });

  // Get pending requests sent by the user (define early so it can be used in filters)
  const sentRequests = (sentRequestsList as any[]).map((r: any) => {
    // Fetch the addressee's full data from allUsers
    const addresseeUser = allUsers.find((u: any) => u.id === r.addresseeId);
    return {
      id: r.id,
      requesterId: user?.id,
      addresseeId: r.addresseeId,
      addressee: addresseeUser || { id: r.addresseeId, username: 'Unknown User' },
      status: 'pending',
      createdAt: r.createdAt,
    };
  });

  const filteredUsers = (allUsers || []).filter((u: any) => {
    if (u.id === user?.id) return false;
    if (u.isAdmin) return false; // Hide admin and superadmin users

    // Check if they are already friends or have a pending request
    const isFriend = (friends as any[]).some(f =>
      (f.requesterId === u.id || f.addresseeId === u.id) && f.status === "accepted"
    );
    const hasRequest = (friends as any[]).some(f =>
      (f.requesterId === u.id || f.addresseeId === u.id) && f.status === "pending"
    );
    // Check if user has already sent a request to this person
    const hasSentRequest = sentRequests.some(r => r.addresseeId === u.id);

    if (isFriend || hasRequest || hasSentRequest) return false;
    if (!searchTerm) return true;

    const searchLower = searchTerm.toLowerCase();
    const firstName = (u.firstName || "").toLowerCase();
    const lastName = (u.lastName || "").toLowerCase();
    const username = (u.username || "").toLowerCase();
    const email = (u.email || "").toLowerCase();
    const fullName = `${firstName} ${lastName}`.trim();
    const primaryWallet = (u.primaryWalletAddress || "").toLowerCase();
    const walletMatches = (u.wallets || []).some((w: any) => 
      w.walletAddress?.toLowerCase().includes(searchLower)
    );

    return (
      firstName.includes(searchLower) ||
      lastName.includes(searchLower) ||
      username.includes(searchLower) ||
      email.includes(searchLower) ||
      fullName.includes(searchLower) ||
      primaryWallet.includes(searchLower) ||
      walletMatches
    );
  });

  const acceptedFriends = (friends as any[]).filter(
    (f: any) => f.status === "accepted",
  );

  // Get pending requests where user is the addressee (received requests)
  const pendingRequests = (requestsList as any[]).map((r: any) => {
    // Fetch the requester's full data from allUsers
    const requesterUser = allUsers.find((u: any) => u.id === r.requesterId);
    return {
      ...r,
      requester: requesterUser || { id: r.requesterId, username: 'Unknown User' }
    };
  });

  const getFriendUser = (friend: any) => {
    return friend.requesterId === user?.id
      ? friend.addressee
      : friend.requester;
  };

  const handleSendRequest = () => {
    if (friendEmail.trim()) {
      // Find user by email, username, or wallet address
      const searchTerm = friendEmail.toLowerCase();
      const foundUser = allUsers.find(
        (u: any) => 
          u.email?.toLowerCase() === searchTerm || 
          u.username?.toLowerCase() === searchTerm ||
          u.primaryWalletAddress?.toLowerCase() === searchTerm ||
          // Also search in all wallet addresses for this user
          (u.wallets && u.wallets.some((w: any) => w.walletAddress?.toLowerCase() === searchTerm))
      );

      if (foundUser) {
        if (foundUser.id === user?.id) {
          toast({
            title: "Error",
            description: "You cannot add yourself as a friend.",
            variant: "destructive",
          });
          return;
        }

        // Check if already friends or pending
        const existingRelation = (friends as any[]).find((f: any) => 
          (f.requesterId === foundUser.id || f.addresseeId === foundUser.id)
        );

        if (existingRelation) {
          toast({
            title: "Info",
            description: existingRelation.status === 'accepted' 
              ? "You are already friends." 
              : "A friend request is already pending.",
          });
          return;
        }

        sendFriendRequestMutation.mutate(foundUser.id);
      } else {
        toast({
          title: "User Not Found",
          description: "Could not find a user with that email, username, or wallet address.",
          variant: "destructive",
        });
      }
    }
  };

  const handleChallengeClick = (user: any) => {
    setSelectedUser(user);
    setShowChallengeModal(true);
    form.setValue("challenged", user.id);
  };

  const onSubmit = (data: z.infer<typeof createChallengeSchema>) => {
    createChallengeMutation.mutate(data);
  };

  if (!user) {
    // Allow unauthenticated users to view friends page but show login prompts for actions
  }

  const filteredUsersFinal = filteredUsers;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 theme-transition pb-[80px] md:pb-0">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header - spacing reduced after removing intro text */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-2">
          <div className="hidden md:block"></div>
        </div>

        {/* Search and Add Friend */}
        <div className="flex items-center gap-4 mb-4 w-full">
          <Input
            placeholder="Search friends..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 focus:ring-2 focus:ring-slate-400 focus:ring-offset-0 focus:border-slate-400 focus-visible:ring-slate-400 placeholder:text-slate-400 placeholder:text-sm rounded-md"
          />

          <Button
            className="bg-[#7440ff] text-white font-black px-6 py-2 rounded-lg shadow hover:bg-[#7440ff]/90"
            onClick={() => setIsAddDialogOpen(true)}
          >
            Add Friend
          </Button>

          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogContent className="sm:max-w-sm max-w-[360px]">
              <DialogHeader>
                <DialogTitle>Add Friend</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">
                    Username or Email
                  </label>
                  <Input
                    type="text"
                    placeholder="Enter email or username..."
                    value={friendEmail}
                    onChange={(e) => setFriendEmail(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div className="flex space-x-2">
                  <Button
                    onClick={() => setIsAddDialogOpen(false)}
                    className="flex-1 bg-slate-100 text-slate-700 hover:bg-slate-200"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSendRequest}
                    disabled={
                      !friendEmail.trim() || sendFriendRequestMutation.isPending
                    }
                    className="flex-1 bg-[#7440ff] text-white hover:bg-[#6538e6] disabled:opacity-60"
                  >
                    {sendFriendRequestMutation.isPending
                      ? "Sending..."
                      : "Send a Request"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Friends Tabs */}
        <Tabs defaultValue="users" className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="users">Users ({filteredUsers.length})</TabsTrigger>
            <TabsTrigger value="friends">Friends ({acceptedFriends.length})</TabsTrigger>
            <TabsTrigger value="requests">
              <div className="flex flex-col leading-tight">
                <span className="text-sm">Requests ({pendingRequests.length + sentRequests.length})</span>
              </div>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="friends" className="space-y-4">
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <FriendUserCardSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {acceptedFriends.map((friend: any) => {
                  const friendUser = getFriendUser(friend);
                  return (
                    <Card
                      key={friend.id}
                      className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    >
                      <CardContent className="p-2 md:p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <UserAvatar
                              userId={friendUser.id}
                              username={friendUser.username || (typeof friendUser.email === 'string' ? friendUser.email : friendUser.email?.address)}
                              src={friendUser.profileImageUrl || friendUser.profileImage || friendUser.avatarUrl}
                              size={36}
                              className="w-9 h-9 border border-slate-100 dark:border-slate-800"
                            />
                            <div>
                              <h3 className="font-bold text-xs text-slate-900 dark:text-slate-100 leading-tight">
                                {friendUser.username || friendUser.firstName}
                              </h3>
                              <p className="text-[10px] text-slate-500 font-medium">
                                Level {friendUser.level || 1} • {friendUser.coins?.toLocaleString() || 0}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-1.5">
                            <Button
                              size="sm"
                              className="h-8 text-[11px] px-2.5 rounded-lg font-bold text-black"
                              style={{ backgroundColor: "#ccff00" }}
                              onClick={() => handleChallengeClick(friendUser)}
                            >
                              Challenge
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="users" className="space-y-2">
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <AllUserCardSkeleton key={i} />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
            {filteredUsersFinal.map((user: any) => (
              <Card
                key={user.id}
                className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              >
                <CardContent className="p-2 md:p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <UserAvatar
                          userId={user.id}
                          username={user.username || (typeof user.email === 'string' ? user.email : user.email?.address)}
                          src={user.profileImageUrl || user.profileImage || user.avatarUrl}
                          size={36}
                          className="w-9 h-9 border border-slate-100 dark:border-slate-800"
                        />
                        <div>
                          <h3 className="font-bold text-xs text-slate-900 dark:text-slate-100 leading-tight">
                            {user.username || user.firstName || "User"}
                          </h3>
                          <p className="text-[10px] text-slate-500 font-medium">
                            Level {user.level || 1} • {user.coins?.toLocaleString() || 0}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-[11px] px-2.5 rounded-lg border-slate-200 dark:border-slate-700 font-medium hover:bg-slate-50"
                          onClick={() => {
                            setPendingFriendId(user.id);
                            sendFriendRequestMutation.mutate(user.id);
                          }}
                          disabled={pendingFriendId === user.id}
                        >
                          <i className="fas fa-user-plus opacity-70"></i>
                          {pendingFriendId === user.id ? "..." : ""}
                        </Button>
                        <Button
                          size="sm"
                          className="h-8 text-[11px] px-2.5 rounded-lg font-bold text-black"
                          style={{ backgroundColor: "#ccff00" }}
                          onClick={() => handleChallengeClick(user)}
                        >
                          Challenge
                        </Button>
                      </div>
                    </div>
                </CardContent>
              </Card>
            ))}
            </div>
            )}
          </TabsContent>

          <TabsContent value="requests" className="space-y-4">
            {requestsLoading || sentRequestsLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <FriendRequestCardSkeleton key={i} />
                ))}
              </div>
            ) : pendingRequests.length === 0 ? (
              <Card className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                <CardContent className="text-center py-12">
                  <i
                    className="fas fa-inbox text-4xl mb-4"
                    style={{ color: "#7440ff" }}
                  ></i>
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
                    No friend requests
                  </h3>
                  <p className="text-slate-600 dark:text-slate-400">
                    When people send you friend requests, they'll appear here.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {pendingRequests.map((request: any) => {
                  const requesterUser = request.requester;
                  return (
                    <Card
                      key={request.id}
                      className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    >
                      <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <UserAvatar
                              userId={requesterUser.id}
                              username={requesterUser.username || (typeof requesterUser.email === 'string' ? requesterUser.email : requesterUser.email?.address)}
                              src={requesterUser.profileImageUrl || requesterUser.profileImage || requesterUser.avatarUrl}
                              size={48}
                              className="w-12 h-12"
                            />
                            <div>
                              <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                                {requesterUser.username ||
                                  requesterUser.firstName}
                              </h3>
                              <p className="text-sm text-slate-600 dark:text-slate-400">
                                Sent{" "}
                                {formatDistanceToNow(
                                  new Date(request.createdAt),
                                  { addSuffix: true },
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              className="bg-emerald-600 text-white hover:bg-emerald-700"
                              onClick={() =>
                                acceptFriendRequestMutation.mutate(request.id)
                              }
                              disabled={acceptFriendRequestMutation.isPending}
                            >
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                declineFriendRequestMutation.mutate(request.id)
                              }
                              disabled={declineFriendRequestMutation.isPending}
                            >
                              Decline
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* Sent requests */}
            <div className="pt-4">
              {sentRequests.length === 0 ? (
                <Card className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                  <CardContent className="text-center py-12">
                    <i className="fas fa-paper-plane text-4xl mb-4" style={{ color: "#7440ff" }}></i>
                    <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">No sent requests</h3>
                    <p className="text-slate-600 dark:text-slate-400">Friend requests you send will appear here.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {sentRequests.map((request: any) => {
                    const addresseeUser = request.addressee;
                    return (
                      <Card key={request.id} className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700">
                        <CardContent className="p-6">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <UserAvatar userId={addresseeUser.id} username={addresseeUser.username || (typeof addresseeUser.email === 'string' ? addresseeUser.email : addresseeUser.email?.address)} src={addresseeUser.profileImageUrl || addresseeUser.profileImage || addresseeUser.avatarUrl} size={48} className="w-12 h-12" />
                              <div>
                                <h3 className="font-semibold text-slate-900 dark:text-slate-100">{addresseeUser.username || addresseeUser.firstName}</h3>
                                <p className="text-sm text-slate-600 dark:text-slate-400">Sent {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}</p>
                              </div>
                            </div>
                            <Badge className="bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">Pending</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Challenge Modal */}
      <Dialog 
        open={showChallengeModal} 
        onOpenChange={(open) => {
          setShowChallengeModal(open);
          if (!open) {
            setSelectedUser(null);
            form.reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-sm max-w-[90vw] max-h-[80vh] overflow-y-auto">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center space-x-2">
              {selectedUser ? (
                <>
                  <UserAvatar
                    userId={selectedUser.id}
                    username={selectedUser.username}
                    src={selectedUser.profileImageUrl || selectedUser.profileImage || selectedUser.avatarUrl}
                    size={24}
                    className="h-6 w-6"
                  />
                  <span>
                    Challenge{" "}
                    {selectedUser.username || selectedUser.firstName}
                  </span>
                </>
              ) : (
                "Create New Challenge"
              )}
            </DialogTitle>
          </DialogHeader>
          {/* Challenge Preview Card */}
          {selectedUser && form.watch("title") && form.watch("amount") && (
            <div className="mb-3">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Preview</div>
              <ChallengePreviewCard
                challenger={{
                  id: (user as any)?.id || '',
                  firstName: (user as any)?.firstName,
                  username: (user as any)?.username,
                  profileImageUrl: (user as any)?.profileImageUrl
                }}
                challenged={selectedUser}
                title={form.watch("title")}
                description={form.watch("description")}
                category={form.watch("category")}
                amount={form.watch("amount")}
                dueDate={form.watch("dueDate")}
              />
            </div>
          )}

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-2"
            >
              {selectedUser && (
                <div className="flex items-center space-x-2 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-slate-800 mb-1">
                  <UserAvatar
                    userId={selectedUser.id}
                    username={selectedUser.username}
                    src={selectedUser.profileImageUrl || selectedUser.profileImage || selectedUser.avatarUrl}
                    size={28}
                    className="h-7 w-7"
                  />
                  <div>
                    <p className="font-bold text-xs text-slate-900 dark:text-slate-100">
                      {selectedUser.username || selectedUser.firstName}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem className="space-y-0">
                      <FormControl>
                        <Input
                          placeholder="Challenge Title"
                          className="h-9 text-sm rounded-lg border-slate-200 dark:border-slate-700 focus:ring-1 focus:ring-primary focus:border-primary"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-[10px] mt-0.5" />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-2">
                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem className="space-y-0">
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger className="h-9 text-sm rounded-lg border-0 bg-slate-100 dark:bg-slate-800 focus:ring-0 focus:border-0 shadow-none ring-0 outline-none">
                              <SelectValue placeholder="Category" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="bg-white dark:bg-slate-900 border-0 shadow-xl p-1">
                            {categories.map((category) => (
                              <SelectItem
                                key={category.value}
                                value={category.value}
                                className="text-sm focus:bg-primary/10 focus:text-primary dark:focus:bg-primary/20 cursor-pointer rounded-md border-0"
                              >
                                <div className="flex items-center space-x-2">
                                  <span>{category.icon}</span>
                                  <span>{category.label}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage className="text-[10px] mt-0.5" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem className="space-y-0">
                        <FormControl>
                          <Input
                            type="number"
                            step="0.000001"
                            placeholder="Stake"
                            className="h-9 text-sm rounded-lg border-slate-200 dark:border-slate-700 focus:ring-1 focus:ring-primary focus:border-primary"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="text-[10px] mt-0.5" />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Token Selection */}
                <FormField
                  control={form.control}
                  name="paymentToken"
                  render={({ field }) => (
                    <FormItem className="space-y-0">
                      <FormControl>
                        <div className="flex gap-1">
                          {['ETH', 'USDT', 'USDC'].map((token) => (
                            <button
                              key={token}
                              type="button"
                              onClick={() => field.onChange(token)}
                              className={`flex-1 rounded-full px-2 h-7 text-xs font-semibold transition-all ${
                                field.value === token
                                  ? "bg-[#7440FF] text-white"
                                  : "bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600"
                              }`}
                            >
                              {token}
                            </button>
                          ))}
                        </div>
                      </FormControl>
                      <FormMessage className="text-[10px] mt-0.5" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem className="space-y-0">
                      <FormControl>
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
                            <i className="fas fa-calendar-alt text-xs"></i>
                          </span>
                          <Input
                            type="datetime-local"
                            className="h-9 text-sm pl-8 rounded-lg border-slate-200 dark:border-slate-700 focus:ring-1 focus:ring-primary focus:border-primary"
                            {...field}
                            min={new Date().toISOString().slice(0, 16)}
                          />
                        </div>
                      </FormControl>
                      <FormMessage className="text-[10px] mt-0.5" />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowChallengeModal(false)}
                  className="flex-1 h-9 text-sm rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createChallengeMutation.isPending}
                  className="flex-1 h-9 text-sm font-bold rounded-lg text-black transition-transform active:scale-95 shadow-sm"
                  style={{ backgroundColor: '#ccff00' }}
                >
                  {createChallengeMutation.isPending ? "Sending..." : "Challenge"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Accept Challenge Modal */}
      <AcceptChallengeModal
        isOpen={showAcceptModal}
        onClose={() => {
          setShowAcceptModal(false);
          setSelectedChallengeToAccept(null);
        }}
        challenge={selectedChallengeToAccept}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/challenges"] });
        }}
      />

      <MobileNavigation />
    </div>
  );
}
