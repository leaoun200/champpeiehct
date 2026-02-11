import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { DynamicMetaTags } from "@/components/DynamicMetaTags";
import { MobileNavigation } from "@/components/MobileNavigation";
import MobileLayout from "@/components/MobileLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserAvatar } from "@/components/UserAvatar";
import { formatDistanceToNow } from "date-fns";
import { formatBalance } from "@/utils/currencyUtils";
import {
  Star,
  Clock,
  MessageCircle,
  Trophy,
  AlertTriangle,
  Edit,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import ConfirmAndStakeButton from '@/components/ConfirmAndStakeButton';

function ActivityCardSkeleton() {
  return (
    <Card className="mb-1 hover:shadow-sm transition-shadow mobile-compact-card border-0 md:border md:border-slate-200 md:dark:border-slate-700 animate-pulse">
      <CardContent className="p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5 flex-1">
            <Skeleton className="w-10 h-10 rounded-lg flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
          <div className="ml-2 flex space-x-1 flex-shrink-0">
            <Skeleton className="h-7 w-16 rounded" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Activities() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  // Edit modal states
  const [editEventModal, setEditEventModal] = useState(false);
  const [editChallengeModal, setEditChallengeModal] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<any>(null);

  // Edit form states
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editEntryFee, setEditEntryFee] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editType, setEditType] = useState("");

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["/api/events"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/events", {
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch events: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        console.error("Error fetching events:", error);
        return [];
      }
    },
    retry: false,
    enabled: !!user,
  });

  const { data: challengesData, isLoading: challengesLoading } = useQuery({
    queryKey: ["/api/challenges"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/challenges", {
          credentials: "include",
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch challenges: ${response.status}`);
        }
        const data = await response.json();
        // API returns { challenges: [...], total: N } - extract the array
        return Array.isArray(data) ? data : (data?.challenges || []);
      } catch (error) {
        console.error("Error fetching challenges:", error);
        return [];
      }
    },
    retry: false,
    enabled: !!user,
  });

  const { data: transactions = [], isLoading: transactionsLoading } = useQuery({
    queryKey: ["/api/transactions", user?.id],
    queryFn: async () => {
      try {
        const result = await apiRequest("GET", "/api/transactions");
        console.log('📊 Transactions API Response:', result);
        // Handle both array and object responses
        if (Array.isArray(result)) {
          return result;
        }
        return result?.transactions || result?.items || [];
      } catch (error) {
        console.error("Error fetching transactions:", error);
        return [];
      }
    },
    retry: false,
    enabled: !!user,
  });

  // Extract challenges from response - queryFn already returns the array
  const challenges = Array.isArray(challengesData) ? challengesData : [];

  if (!user) return null;

  // Debug logging
  console.log('Activities Debug:', {
    user: user?.id,
    challengesLoading,
    challengesCount: challenges.length,
    challenges: challenges.slice(0, 2), // Show first 2
    eventsLoading,
    eventsCount: events.length,
  });

  // Combine and categorize all activities
  const allActivities = [
    ...(Array.isArray(events) ? events.map((event: any) => ({ ...event, type: "event" })) : []),
    ...(Array.isArray(challenges) ? challenges.map((challenge: any) => ({
      ...challenge,
      type: "challenge",
    })) : []),
  ];

  const createdActivities = allActivities.filter(
    (activity) => {
      // For events: check creatorId or createdBy
      if (activity.type === "event") {
        return activity.creatorId === user.id || activity.createdBy === user.id;
      }
      // For challenges: check if user is the challenger (creator)
      if (activity.type === "challenge") {
        return activity.challengerUser?.id === user.id || activity.challenger === user.id;
      }
      return false;
    }
  );

  const activeActivities = allActivities.filter(
    (activity) => activity.status === "active" || activity.status === "live",
  );

  const discussActivities = allActivities.filter(
    (activity) => activity.chatEnabled || activity.type === "challenge",
  );

  // Include all challenges the user has participated in (including admin-created ones)
  const participatedChallenges = Array.isArray(challenges) ? challenges.filter(
    (challenge: any) => challenge.challengerUser?.id === user.id || challenge.challengedUser?.id === user.id,
  ) : [];

  // Won challenges - when user is the winner
  const wonActivities = Array.isArray(challenges) ? challenges.filter(
    (challenge: any) => {
      if (challenge.status !== 'completed') return false;
      
      if (challenge.result === 'challenger_won' && challenge.challengerUser?.id === user.id) return true;
      if (challenge.result === 'challenged_won' && challenge.challengedUser?.id === user.id) return true;
      
      return false;
    }
  ) : [];

  // Lost challenges - when user is not the winner but participated
  const lostActivities = Array.isArray(challenges) ? challenges.filter(
    (challenge: any) => {
      if (challenge.status !== 'completed') return false;
      
      const userIsChallenger = challenge.challengerUser?.id === user.id;
      const userIsChallenged = challenge.challengedUser?.id === user.id;
      
      if (!userIsChallenger && !userIsChallenged) return false;
      
      // User lost if they participated but didn't win
      if (challenge.result === 'challenger_won' && userIsChallenged) return true;
      if (challenge.result === 'challenged_won' && userIsChallenger) return true;
      
      return false;
    }
  ) : [];

  const getActivityImage = (activity: any) => {
    if (activity.type === "event") {
      // Check for proper image URL, fallback to solid color
      if (activity.image_url && activity.image_url !== "TEST IMAGE") {
        return activity.image_url;
      }
      // Use a solid color fallback
      return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%237440ff' width='100' height='100'/%3E%3Ctext x='50' y='50' font-size='24' fill='white' text-anchor='middle' dy='.3em'%3E📌%3C/text%3E%3C/svg%3E";
    }
    // For challenges, use the cover image if available, otherwise use solid color
    if (activity.coverImageUrl) {
      return activity.coverImageUrl;
    }
    // Use a solid color fallback with icon instead of trying to load missing image
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%237440ff' width='100' height='100'/%3E%3Ctext x='50' y='50' font-size='24' fill='white' text-anchor='middle' dy='.3em'%3E⚔️%3C/text%3E%3C/svg%3E";
  };

  const getTokenSymbol = (activity: any): string => {
    if (activity.type === "challenge") {
      // Try paymentTokenAddress first (from blockchain challenges)
      let tokenAddr = activity.paymentTokenAddress || activity.paymentToken;
      
      if (tokenAddr) {
        const tokenStr = String(tokenAddr).toLowerCase();
        
        // Check if it's already a symbol
        if (['eth', 'usdt', 'usdc'].includes(tokenStr)) {
          return tokenStr.toUpperCase();
        }
        
        // Check if it's an address
        if (tokenStr.startsWith('0x')) {
          const tokenLower = tokenStr.toLowerCase();
          if (tokenLower === '0x4200000000000000000000000000000000000006') {
            return 'ETH';
          } else if (tokenLower === '0x3c499c542cef5e3811e1192ce70d8cc7d307b653') {
            return 'USDT';
          } else if (tokenLower === '0x036cbd53842c5426634e7929541ec2318f3dcf7e') {
            return 'USDC';
          }
        }
      }
    }
    return ''; // For events or unknown tokens
  };

  const getStatusBadge = (activity: any) => {
    const status = activity.status || "pending";
    const colors: Record<string, string> = {
      active: "bg-purple-500 text-white",
      live: "bg-green-500 text-white",
      pending: "bg-yellow-500 text-white",
      completed: "bg-blue-500 text-white",
      settled: "bg-gray-500 text-white",
    };
    return colors[status] || "bg-gray-500 text-white";
  };

  const canEditActivity = (activity: any) => {
    // Can only edit if the activity hasn't started yet
    if (activity.type === "event") {
      const endDate = new Date(activity.endDate);
      const now = new Date();
      return now < endDate && (activity.status === "pending" || activity.status === "active");
    } else if (activity.type === "challenge") {
      const dueDate = new Date(activity.dueDate);
      const now = new Date();
      return now < dueDate && activity.status === "active";
    }
    return false;
  };

  const openEditModal = (activity: any) => {
    setSelectedActivity(activity);

    if (activity.type === "event") {
      setEditTitle(activity.title || "");
      setEditDescription(activity.description || "");
      setEditCategory(activity.category || "");
      setEditEntryFee(activity.entryFee?.toString() || "");

      // Format date and time for inputs
      if (activity.endDate) {
        const endDate = new Date(activity.endDate);
        setEditEndDate(endDate.toISOString().split('T')[0]);
        setEditEndTime(endDate.toTimeString().slice(0, 5));
      }

      setEditEventModal(true);
    } else if (activity.type === "challenge") {
      setEditTitle(activity.title || "");
      setEditDescription(activity.description || "");
      setEditType(activity.type || "");
      setEditAmount(activity.amount?.toString() || "");

      setEditChallengeModal(true);
    }
  };

  const editEventMutation = useMutation({
    mutationFn: async () => {
      const endDateTime = new Date(`${editEndDate}T${editEndTime}`);
      return apiRequest('PUT', `/api/events/${selectedActivity.id}`, {
        title: editTitle,
        description: editDescription,
        category: editCategory,
        entryFee: parseInt(editEntryFee),
        endDate: endDateTime.toISOString()
      });
    },
    onSuccess: () => {
      toast({
        title: "Event Updated!",
        description: "Your event has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/events'] });
      setEditEventModal(false);
      setSelectedActivity(null);
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Something went wrong. Please try again.",
        variant: "destructive"
      });
    }
  });

  const editChallengeMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('PUT', `/api/challenges/${selectedActivity.id}`, {
        title: editTitle,
        description: editDescription,
        amount: parseInt(editAmount)
      });
    },
    onSuccess: () => {
      toast({
        title: "Challenge Updated!",
        description: "Your challenge has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/challenges'] });
      setEditChallengeModal(false);
      setSelectedActivity(null);
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message || "Something went wrong. Please try again.",
        variant: "destructive"
      });
    }
  });

  const ActivityCard = ({ activity }: { activity: any }) => {
    const [isDeclining, setIsDeclining] = useState(false);
    const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
    // Live countdown for activities with votingEndsAt
    useEffect(() => {
      let t: any = null;
      const compute = () => {
        if (!activity || !activity.votingEndsAt) {
          setCountdownSeconds(null);
          return;
        }
        const ends = new Date(activity.votingEndsAt).getTime();
        const now = Date.now();
        const diff = Math.max(0, Math.floor((ends - now) / 1000));
        setCountdownSeconds(diff);
      };
      compute();
      t = setInterval(compute, 1000);
      return () => clearInterval(t);
    }, [activity]);
    const tokenSymbol = getTokenSymbol(activity);
    const challengedUser = activity.type === "challenge" 
      ? (activity.challengedUser || activity.opponent)
      : null;
    
    return (
      <Card 
        className="mb-1 hover:shadow-sm transition-shadow mobile-compact-card border-0 md:border md:border-slate-200 md:dark:border-slate-700 cursor-pointer"
        onClick={() => {
          if (activity.type === "challenge") {
            navigate(`/challenge/${activity.id}`);
          } else if (activity.type === "event") {
            navigate(`/event/${activity.id}`);
          }
        }}
      >
        <CardContent className="p-2">
        <div className="flex items-center justify-between">
          <div 
            className="flex items-center space-x-2.5 flex-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
              <img
                src={getActivityImage(activity)}
                alt={activity.title || activity.description}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.src = activity.type === "challenge" ? "/assets/versus.svg" : "/assets/default-event-banner.jpg";
                }}
              />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-1.5 mb-1 overflow-hidden">
                <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">
                  {activity.title || activity.description}
                </h3>
                {challengedUser && (
                  <span className="text-xs text-gray-600 dark:text-gray-400 flex-shrink-0">
                    vs {challengedUser.username || challengedUser.firstName || 'User'}
                  </span>
                )}
                <Badge className={`text-xs px-1.5 py-0.5 h-5 ${getStatusBadge(activity)} flex-shrink-0`}>
                  {activity.status || "pending"}
                </Badge>
              </div>

              <div className="flex items-center space-x-2.5 text-xs text-gray-600 dark:text-gray-400">
                <div className="flex items-center space-x-1">
                  <Clock className="w-3 h-3" />
                  <span>
                    {formatDistanceToNow(new Date(activity.createdAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                <div className="flex items-center space-x-1">
                  <Trophy className="w-3 h-3" />
                  <span>{activity.participantsCount || 0}</span>
                </div>
              </div>

              <div className="mt-0.5">
                <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                  {activity.amount || activity.entryFee || activity.betAmount || 0}{" "}
                  {tokenSymbol ? tokenSymbol : activity.type === "challenge" ? "Unknown" : "Pool"}
                </span>
              </div>
            </div>
          </div>

          <div 
            className="ml-2 flex space-x-1 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {canEditActivity(activity) && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openEditModal(activity);
                }}
                className="h-7 px-2 text-xs"
              >
                <Edit className="w-3 h-3" />
                <span className="hidden sm:inline sm:ml-1">Edit</span>
              </Button>
            )}
            {activity.type === 'challenge' && activity.status === 'open' && user && user.id !== activity.challenger ? (
              <div className="flex items-center gap-2">
                <ConfirmAndStakeButton challengeId={activity.id} role="acceptor" />
                <button
                  className="h-7 px-2 rounded text-sm bg-red-100 text-red-700"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm('Decline this challenge?')) return;
                    setIsDeclining(true);
                    try {
                      const res = await fetch(`/api/challenges/${activity.id}`, {
                        method: 'PATCH',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'cancelled' }),
                      });
                      if (!res.ok) throw new Error('Failed to decline');
                      queryClient.invalidateQueries({ queryKey: ['/api/challenges'] });
                      toast({ title: 'Challenge declined' });
                    } catch (err: any) {
                      toast({ title: 'Decline failed', description: err.message || String(err), variant: 'destructive' });
                    } finally {
                      setIsDeclining(false);
                    }
                  }}
                  disabled={isDeclining}
                >
                  {isDeclining ? 'Declining...' : 'Decline'}
                </button>
              </div>
            ) : (
              <Button
                style={{ backgroundColor: "#7440ff", color: "white" }}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  if (activity.type === "challenge") {
                    navigate(`/challenge/${activity.id}`);
                  } else if (activity.type === "event") {
                    navigate(`/event/${activity.id}`);
                  }
                }}
              >
                <MessageCircle className="w-3 h-3" />
                <span className="hidden sm:inline sm:ml-1">Chat</span>
              </Button>
            )}
            {countdownSeconds != null && (
              <div className="text-xs text-yellow-700 ml-2 flex items-center">
                {countdownSeconds > 0 ? (
                  <>Ends in {Math.floor(countdownSeconds / 60)}m {countdownSeconds % 60}s</>
                ) : (
                  <>Ending soon</>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
    );
  };

  const TransactionCard = ({ transaction }: { transaction: any }) => {
    const isCoinTransaction = ['gift_sent', 'gift_received', 'challenge_escrow'].includes(transaction.type);
    const isPositive = transaction.type === "win" || transaction.type === "prize" || transaction.type === "gift_received";

    return (
      <Card className="mb-1 hover:shadow-sm transition-shadow mobile-compact-card border-0 md:border md:border-slate-200 md:dark:border-slate-700">
        <CardContent className="p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
              {isPositive ? (
                <Trophy className="w-4 h-4 text-green-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-500" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                {transaction.description || `${transaction.type} transaction`}
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {formatDistanceToNow(new Date(transaction.createdAt), {
                  addSuffix: true,
                })}
              </p>
            </div>
          </div>

          <div className="text-right flex-shrink-0">
            <span
              className={`font-semibold text-sm ${
                isPositive
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              {isPositive
                ? "+"
                : "-"}
              {isCoinTransaction 
                ? `${Math.abs(parseInt(transaction.amount)).toLocaleString()} coins`
                : formatBalance(transaction.amount)
              }
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 theme-transition pb-[50px]">
      <DynamicMetaTags 
        pageType="profile"
        customTitle={`${(user as any)?.username || 'User'}'s Activities on Bantah`}
        customDescription={`Check out ${(user as any)?.username || 'User'}'s activity history on Bantah. Challenges created, active contests, wins, and more on the social betting platform.`}
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Compact Tab Navigation */}
            <Tabs defaultValue="created" className="space-y-2">
              <TabsList className="grid w-full grid-cols-5 h-8 sm:h-9 border-0 shadow-none bg-transparent gap-1">
                <TabsTrigger value="created" className="flex items-center space-x-1 text-xs">
                  <i className="fas fa-plus text-xs"></i>
                  <span className="hidden sm:inline">Created</span>
                  <span>({createdActivities.length})</span>
                </TabsTrigger>
                <TabsTrigger value="active" className="flex items-center space-x-1 text-xs">
                  <i className="fas fa-clock text-xs"></i>
                  <span className="hidden sm:inline">Active</span>
                  <span>({activeActivities.length})</span>
                </TabsTrigger>
                <TabsTrigger value="discuss" className="flex items-center space-x-1 text-xs">
                  <i className="fas fa-handshake text-xs"></i>
                  <span className="hidden sm:inline">Participated</span>
                  <span>({participatedChallenges.length})</span>
                </TabsTrigger>
                <TabsTrigger value="won" className="flex items-center space-x-1 text-xs">
                  <i className="fas fa-trophy text-xs"></i>
                  <span className="hidden sm:inline">Won</span>
                  <span>({wonActivities.length})</span>
                </TabsTrigger>
                <TabsTrigger value="lost" className="flex items-center space-x-1 text-xs">
                  <i className="fas fa-exclamation-triangle text-xs"></i>
                  <span className="hidden sm:inline">Lost</span>
                  <span>({lostActivities.length})</span>
                </TabsTrigger>
              </TabsList>

            <TabsContent value="created" className="space-y-2">
              {eventsLoading || challengesLoading ? (
                <>
                  <ActivityCardSkeleton />
                  <ActivityCardSkeleton />
                  <ActivityCardSkeleton />
                </>
              ) : createdActivities.length === 0 ? (
                <Card className="bg-white dark:bg-slate-800 mobile-compact-card border-0 md:border md:border-slate-200 md:dark:border-slate-700">
                  <CardContent className="text-center py-6">
                    <i className="fas fa-star text-3xl mb-3" style={{ color: '#7440ff' }}></i>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                      No created activities yet
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Start by creating an event or challenge!
                    </p>
                  </CardContent>
                </Card>
              ) : (
                createdActivities.map((activity: any) => (
                  <ActivityCard
                    key={`${activity.type}-${activity.id}`}
                    activity={activity}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="active" className="space-y-2">
              {eventsLoading || challengesLoading ? (
                <>
                  <ActivityCardSkeleton />
                  <ActivityCardSkeleton />
                  <ActivityCardSkeleton />
                </>
              ) : participatedChallenges.filter(c => c.status === "active" || c.status === "live").length === 0 ? (
                <Card className="bg-white dark:bg-slate-800 mobile-compact-card border-0 md:border md:border-slate-200 md:dark:border-slate-700">
                  <CardContent className="text-center py-6">
                    <i className="fas fa-clock text-3xl mb-3" style={{ color: '#7440ff' }}></i>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                      No active activities
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Accept pending challenges or join events to get started!
                    </p>
                  </CardContent>
                </Card>
              ) : (
                participatedChallenges.filter(c => c.status === "active" || c.status === "live").map((challenge: any) => (
                  <ActivityCard
                    key={`challenge-${challenge.id}`}
                    activity={{ ...challenge, type: "challenge" }}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="discuss" className="space-y-2">
              {eventsLoading || challengesLoading ? (
                <>
                  <ActivityCardSkeleton />
                  <ActivityCardSkeleton />
                  <ActivityCardSkeleton />
                </>
              ) : participatedChallenges.length === 0 ? (
                <Card className="bg-white dark:bg-slate-800 mobile-compact-card border-0 md:border md:border-slate-200 md:dark:border-slate-700">
                  <CardContent className="text-center py-6">
                    <i className="fas fa-handshake text-3xl mb-3" style={{ color: '#7440ff' }}></i>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                      No challenges participated yet
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Accept or join challenges to see them here!
                    </p>
                  </CardContent>
                </Card>
              ) : (
                participatedChallenges.map((challenge: any) => (
                  <ActivityCard
                    key={`challenge-${challenge.id}`}
                    activity={{ ...challenge, type: "challenge" }}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="won" className="space-y-2">
              {eventsLoading || challengesLoading ? (
                <>
                  <ActivityCardSkeleton />
                  <ActivityCardSkeleton />
                  <ActivityCardSkeleton />
                </>
              ) : wonActivities.length === 0 ? (
                <Card className="bg-white dark:bg-slate-800 mobile-compact-card border-0 md:border md:border-slate-200 md:dark:border-slate-700">
                  <CardContent className="text-center py-6">
                    <i className="fas fa-trophy text-3xl mb-3" style={{ color: '#7440ff' }}></i>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                      No victories yet
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Complete challenges to claim your victories!
                    </p>
                  </CardContent>
                </Card>
              ) : (
                wonActivities.map((challenge: any) => (
                  <ActivityCard
                    key={`won-${challenge.id}`}
                    activity={{ ...challenge, type: "challenge" }}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="lost" className="space-y-2">
              {eventsLoading || challengesLoading ? (
                <>
                  <ActivityCardSkeleton />
                  <ActivityCardSkeleton />
                  <ActivityCardSkeleton />
                </>
              ) : lostActivities.length === 0 ? (
                <Card className="bg-white dark:bg-slate-800 mobile-compact-card border-0 md:border md:border-slate-200 md:dark:border-slate-700">
                  <CardContent className="text-center py-6">
                    <i className="fas fa-exclamation-triangle text-3xl mb-3" style={{ color: '#7440ff' }}></i>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                      No losses recorded
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Keep up the good work!
                    </p>
                  </CardContent>
                </Card>
              ) : (
                lostActivities.map((challenge: any) => (
                  <ActivityCard
                    key={`lost-${challenge.id}`}
                    activity={{ ...challenge, type: "challenge" }}
                  />
                ))
              )}
            </TabsContent>


          </Tabs>
        </div>

      {/* Edit Event Modal */}
      <Dialog open={editEventModal} onOpenChange={setEditEventModal}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Event</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label htmlFor="editTitle">Title</Label>
              <Input
                id="editTitle"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Event title"
              />
            </div>
            <div>
              <Label htmlFor="editDescription">Description</Label>
              <Textarea
                id="editDescription"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Event description"
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="editCategory">Category</Label>
              <Select value={editCategory} onValueChange={setEditCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sports">Sports</SelectItem>
                  <SelectItem value="entertainment">Entertainment</SelectItem>
                  <SelectItem value="politics">Politics</SelectItem>
                  <SelectItem value="technology">Technology</SelectItem>
                  <SelectItem value="crypto">Cryptocurrency</SelectItem>
                  <SelectItem value="business">Business</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="editEntryFee">Entry Fee ($)</Label>
              <Input
                id="editEntryFee"
                type="number"
                value={editEntryFee}
                onChange={(e) => setEditEntryFee(e.target.value)}
                placeholder="Entry fee"
                min="1"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="editEndDate">End Date</Label>
                <Input
                  id="editEndDate"
                  type="date"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="editEndTime">End Time</Label>
                <Input
                  id="editEndTime"
                  type="time"
                  value={editEndTime}
                  onChange={(e) => setEditEndTime(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2 pt-3">
              <Button variant="outline" onClick={() => setEditEventModal(false)} className="h-8 px-3 text-sm">
                Cancel
              </Button>
              <Button 
                onClick={() => editEventMutation.mutate()}
                disabled={editEventMutation.isPending}
                className="h-8 px-3 text-sm"
              >
                {editEventMutation.isPending ? "Updating..." : "Update Event"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Challenge Modal */}
      <Dialog open={editChallengeModal} onOpenChange={setEditChallengeModal}>
        <DialogContent className="sm:max-w-[425px] max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg">Edit Challenge</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="editChallengeTitle" className="text-sm font-medium">Title</Label>
              <Input
                id="editChallengeTitle"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Challenge title"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="editChallengeDescription" className="text-sm font-medium">Description</Label>
              <Textarea
                id="editChallengeDescription"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Challenge description"
                rows={2}
                className="min-h-[60px] text-sm resize-none"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="editChallengeAmount" className="text-sm font-medium">Stake Amount ($)</Label>
              <Input
                id="editChallengeAmount"
                type="number"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                placeholder="Stake amount"
                min="1"
                className="h-9 text-sm"
              />
            </div>
            <div className="flex justify-end space-x-2 pt-3">
              <Button variant="outline" onClick={() => setEditChallengeModal(false)} className="h-8 px-3 text-sm">
                Cancel
              </Button>
              <Button 
                onClick={() => editChallengeMutation.mutate()}
                disabled={editChallengeMutation.isPending}
                className="h-8 px-3 text-sm"
              >
                {editChallengeMutation.isPending ? "Updating..." : "Update Challenge"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <MobileNavigation />
    </div>
  );
}