import { getBlockchainClient } from '../blockchain/client';
/**
 * Phase 4: API Routes - Challenge Operations
 * REST endpoints for challenge creation, joining, and management
 * 
 * Points Distribution (New System):
 * - Challenge Creation: 50 + (Amount × 5) = MAX 500 pts
 * - Challenge Joining: 10 + (Amount × 4) = MAX 500 pts
 * - Referral: 200 pts (one-time per user)
 * - Weekly claiming enabled
 */

import { ethers } from 'ethers';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { isAuthenticated } from '../auth';
import { PrivyAuthMiddleware } from '../privyAuth';
import { NotificationService, NotificationEvent, NotificationChannel, NotificationPriority } from '../notificationService';
import {
  createAdminChallenge,
  createP2PChallenge,
  joinAdminChallenge,
  acceptP2PChallenge,
  getChallenge,
  getChallengeParticipants,
  getUserLockedStakes,
  getTokenBalance,
  approveToken,
} from '../blockchain/helpers';
import {
  recordPointsTransaction,
  createEscrowRecord,
  recordContractDeployment,
  addUserWallet,
  getUserPrimaryWallet as dbGetUserPrimaryWallet,
  updateUserPointsBalance,
} from '../blockchain/db-utils';
import { calculateCreationPoints, calculateParticipationPoints } from '../utils/points-calculator';
import { notifyPointsEarnedParticipation, notifyPointsEarnedCreation } from '../utils/bantahPointsNotifications';
import { notifyOpponentVoted, notifyProofSubmitted, notifyChallengeActivated, notifyEscrowLocked, notifyDisputeRaised, notifyNewChatMessage } from '../utils/challengeActivityNotifications';
import { db } from '../db';
import { challenges, users } from '../../shared/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { telegramBot } from '../telegramBot';

const router = Router();

// Multer configuration for evidence file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 5 // Maximum 5 files per submission
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types for evidence and cover images
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/svg+xml',
      'image/webp',
      'video/mp4',
      'video/webm',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  }
});
const notificationService = new NotificationService();

/**
 * GET /api/challenges/public
 * Get all public challenges (no auth required)
 * IMPORTANT: Only shows OPEN P2P challenges (where challenged == null)
 * Direct P2P challenges (challenged user specified) are NOT shown publicly
 * They only appear in recipient's Notifications/Activities (like friend requests)
 */
router.get('/public', async (req: Request, res: Response) => {
  try {
    const allChallenges = await db.select().from(challenges);
    
    // Filter public challenges: Only OPEN P2P challenges (no specific opponent)
    // EXCLUDE Direct P2P challenges (where challenged is set - like friend requests)
    const publicChallenges = allChallenges.filter(c => 
      (c.status === 'open' || c.status === 'active' || c.status === 'completed' || c.status === 'pending') &&
      (!c.adminCreated) && // Only P2P challenges, no admin betting pools
      (c.challenged === null || c.challenged === undefined) // Only OPEN challenges, not Direct P2P
    );

    // Get unique user IDs from the challenges
    const userIds = new Set<string>();
    publicChallenges.forEach(challenge => {
      if (challenge.challenger) userIds.add(challenge.challenger);
      if (challenge.challenged) userIds.add(challenge.challenged);
    });

    // Fetch user data for all unique user IDs
    const usersData = await db
      .select({
        id: users.id,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
      })
      .from(users)
      .where(inArray(users.id, Array.from(userIds)));

    // Get primary wallet addresses for all users
    const userMap = new Map();
    for (const user of usersData) {
      const primaryWallet = await dbGetUserPrimaryWallet(user.id);
      userMap.set(user.id, {
        ...user,
        primaryWalletAddress: primaryWallet?.walletAddress || null,
      });
    }

    // Combine challenge data with user data
    const challengesWithUsers = publicChallenges.map(challenge => ({
      ...challenge,
      challengerUser: challenge.challenger ? userMap.get(challenge.challenger) : null,
      challengedUser: challenge.challenged ? userMap.get(challenge.challenged) : null,
    }));

    console.log(`📊 GET /api/challenges/public: ${challengesWithUsers.length} challenges found`);
    res.json(challengesWithUsers);
  } catch (error: any) {
    console.error('Error fetching public challenges:', error);
    res.status(500).json({ error: 'Failed to fetch challenges' });
  }
});

/**
 * GET /api/challenges/debug/status
 * Debug endpoint to check database and API health
 */
router.get('/debug/status', async (req: Request, res: Response) => {
  try {
    const allChallenges = await db.select().from(challenges);
    const statuses = allChallenges.reduce((acc: any, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {});

    const activeCount = allChallenges.filter(c => 
      c.status === 'open' || c.status === 'active' || c.status === 'completed' || c.status === 'pending'
    ).length;

    console.log(`\n🔍 Challenge Status Debug:`);
    console.log(`   Total challenges in DB: ${allChallenges.length}`);
    console.log(`   By status: ${JSON.stringify(statuses)}`);
    console.log(`   Public challenges (displayed): ${activeCount}`);

    res.json({
      success: true,
      total: allChallenges.length,
      byStatus: statuses,
      publicCount: activeCount,
      recentChallenges: allChallenges
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5)
        .map(c => ({
          id: c.id,
          title: c.title,
          status: c.status,
          challenger: c.challenger,
          createdAt: c.createdAt,
          transactionHash: c.creatorTransactionHash
        }))
    });
  } catch (error: any) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/challenges/create-admin
 * Create a new admin-created challenge (betting pool)
 */
router.post('/create-admin', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { stakeAmount, paymentToken, metadataURI, title, description, category, dueDate } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!stakeAmount || !paymentToken || !metadataURI) {
      return res.status(400).json({
        error: 'Missing required fields: stakeAmount, paymentToken, metadataURI',
      });
    }

    // Validate token addresses (USDC or USDT on Base Sepolia)
    const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b3566dA8860';
    const USDT = '0x3c499c542cEF5E3811e1192ce70d8cC7d307B653';
    
    if (![USDC, USDT].includes(paymentToken.toLowerCase())) {
      return res.status(400).json({
        error: 'Invalid token. Must be USDC or USDT',
      });
    }

    console.log(`\n💾 Creating admin challenge from ${userId}...`);

    // Calculate creation points using the new system (20 points fixed)
    const stakeAmountUSD = parseInt(stakeAmount); // USDC/USDT amounts are in USD equivalent
    const creationPoints = calculateCreationPoints(stakeAmountUSD);
    console.log(`🎁 Challenge creator will earn ${creationPoints} Bantah Points`);

    // Parse and validate dueDate (optional). Default to 24h from now if not provided.
    const parsedDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (isNaN(parsedDueDate.getTime()) || parsedDueDate.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Invalid dueDate. Must be a future date.' });
    }

    // Create challenge in database first
    const dbChallenge = await db
      .insert(challenges)
      .values({
        title,
        description,
        category: category || 'general',
        amount: parseInt(stakeAmount) * 2, // Display both sides
        status: 'pending',
        adminCreated: true,
        challenger: userId,
        dueDate: parsedDueDate,
        paymentTokenAddress: paymentToken,
        stakeAmountWei: BigInt(stakeAmount + '000000'), // 6 decimals for USDC/USDT
        onChainStatus: 'pending',
        pointsAwarded: creationPoints, // Store creation points for winner to earn
      })
      .returning();

    const challengeId = dbChallenge[0].id;
    console.log(`📋 Challenge created in DB with ID: ${challengeId}`);

    // Create on-chain
    console.log(`⛓️  Creating on-chain...`);
    const txResult = await createAdminChallenge(
      stakeAmount,
      paymentToken,
      metadataURI
    );

    // Update database with blockchain info
    await db
      .update(challenges)
      .set({
        blockchainCreationTxHash: txResult.transactionHash,
        blockchainBlockNumber: txResult.blockNumber,
        onChainStatus: 'active',
        onChainResolved: false,
      })
      .where(eq(challenges.id, challengeId));

    console.log(`✅ Admin challenge created: ${txResult.transactionHash}`);

    // Broadcast to Telegram (NO tags for admin challenges)
    try {
      // Get the challenge from database to access coverImageUrl
      const dbChallenge = await db
        .select()
        .from(challenges)
        .where(eq(challenges.id, challengeId))
        .limit(1);
      
      await telegramBot.broadcastChallenge({
        id: challengeId,
        title,
        description,
        amount: parseInt(stakeAmount),
        category: category || 'general',
        creator: { username: 'Admin', firstName: 'Admin' },
        challengeType: 'admin',
        status: 'pending',
        isAdminChallenge: true, // No tags for admin challenges
        coverImageUrl: dbChallenge[0]?.coverImageUrl || undefined,
      });
    } catch (err) {
      console.error('Failed to broadcast admin challenge to Telegram:', err);
      // Don't fail the challenge creation if Telegram posting fails
    }

    res.json({
      success: true,
      challengeId,
      transactionHash: txResult.transactionHash,
      blockNumber: txResult.blockNumber,
      title,
      stakeAmount,
      paymentToken,
    });
  } catch (error: any) {
    console.error('Failed to create admin challenge:', error);
    res.status(500).json({
      error: 'Failed to create challenge',
      message: error.message,
    });
  }
});

/**
 * POST /api/challenges/create-p2p
 * Create a P2P challenge (direct or open)
 * - Direct P2P: opponentId specified, only that user can accept
 * - Open Challenge: opponentId null/undefined, anyone can accept
 * Note: User must sign the blockchain transaction client-side with their wallet
 */
router.post('/create-p2p', PrivyAuthMiddleware, upload.single('coverImage'), async (req: Request, res: Response) => {
  try {
    const { opponentId, stakeAmount, paymentToken, metadataURI, title, description, challengeType, dueDate, transactionHash, side, settlementType } = req.body;
    const userId = req.user?.id;

    console.log(`\n📨 POST /api/challenges/create-p2p`);
    console.log(`  ✓ Auth successful - userId: ${userId?.substring(0, 20)}...`);
    const safeTxPreview = transactionHash
      ? (typeof transactionHash === 'string' ? transactionHash.substring(0, 10) + '...' : JSON.stringify(transactionHash).slice(0, 10) + '...')
      : 'NONE';

    console.log(`  ✓ Request received with:`);
    console.log(`    - title: ${title}`);
    console.log(`    - stakeAmount: ${stakeAmount}`);
    console.log(`    - paymentToken: ${paymentToken}`);
    console.log(`    - transactionHash: ${safeTxPreview}`);
    console.log(`    - challengeType: ${challengeType}`);
    console.log(`    - has coverImage file: ${!!req.file}`);
    if (req.file) {
      console.log(`    - coverImage: ${req.file.originalname} (${req.file.size} bytes, ${req.file.mimetype})`);
    }

    // Normalize and mask incoming transactionHash to avoid storing malformed values
    const rawTx = transactionHash;
    let normalizedTx: string | null = null;
    if (typeof rawTx === 'string') {
      const t = rawTx.trim();
      if (t !== '' && t.toLowerCase() !== 'undefined' && t.toLowerCase() !== 'null' && /^0x[a-fA-F0-9]{64}$/.test(t)) {
        normalizedTx = t;
      }
    }

    const maskedTxLog = normalizedTx
      ? `${normalizedTx.substring(0, 10)}...${normalizedTx.substring(normalizedTx.length - 4)}`
      : (typeof rawTx === 'string' && rawTx.trim() !== '' ? `INVALID(${String(rawTx).slice(0,20)})` : 'NONE');

    console.log(`    - received transactionHash (masked): ${maskedTxLog}`);

    if (!userId) {
      console.error('❌ User ID not found in request');
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!stakeAmount || !paymentToken) {
      console.error(`❌ Missing required fields: stakeAmount=${!!stakeAmount}, paymentToken=${!!paymentToken}`);
      return res.status(400).json({
        error: 'Missing required fields: stakeAmount, paymentToken',
      });
    }

    // Determine if this is open or direct P2P
    const isOpenChallenge = !opponentId;
    const type = challengeType || (isOpenChallenge ? 'open' : 'p2p');

    if (!isOpenChallenge && userId === opponentId) {
      return res.status(400).json({
        error: 'Cannot challenge yourself',
      });
    }

    console.log(`\n💾 Creating ${type} challenge: creator=${userId}${!isOpenChallenge ? ` opponent=${opponentId}` : ' (open - any joiner)'}`);

    // Off-chain creation: status stays 'pending' or 'open', onChainStatus stays 'pending'
    // Creator does NOT stake at this point.
    
    // NEW MODEL (v2): Challenge MUST have on-chain transaction hash at creation
    // Off-chain only creation is no longer supported
    if (!normalizedTx || !/^0x[0-9a-f]{64}$/.test(normalizedTx)) {
      return res.status(400).json({
        error: 'Challenge creation requires a blockchain transaction hash. Please sign the transaction first.',
        message: 'Ensure you have called the blockchain creation function and received a valid transactionHash (0x...)',
      });
    }

    // Parse and validate dueDate (optional). Default to 24h from now if not provided.
    const parsedDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (isNaN(parsedDueDate.getTime()) || parsedDueDate.getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Invalid dueDate. Must be a future date.' });
    }

    const stakeAmountUSD = parseFloat(stakeAmount);
    const creationPoints = calculateCreationPoints(stakeAmountUSD);

    const isNativeETH = paymentToken === '0x0000000000000000000000000000000000000000' || paymentToken?.toLowerCase() === '0x0000000000000000000000000000000000000000';
    const tokenDecimals = isNativeETH ? 18 : 6;

    const dbChallenge = await db
      .insert(challenges)
      .values({
        title,
        description,
        category: 'p2p',
        amount: parseFloat(stakeAmount),
        status: isOpenChallenge ? 'open' : 'pending',
        adminCreated: false,
        challenger: userId,
        challenged: opponentId || null,
        challengerSide: side || 'YES',
        dueDate: parsedDueDate,
        paymentTokenAddress: paymentToken,
        stakeAmountWei: BigInt(ethers.parseUnits(stakeAmount, tokenDecimals).toString()),
        onChainStatus: 'pending', // Will be updated below when tx is confirmed
        creatorStaked: true, // Marked as staked since tx hash is provided
        acceptorStaked: false,
        pointsAwarded: creationPoints,
        creatorTransactionHash: normalizedTx, // Store tx immediately
        settlementType: settlementType || 'voting',
      })
      .returning();

    const challengeId = dbChallenge[0].id;
    console.log(`✅ ${type} challenge created off-chain in DB: ${challengeId}`);

    // Process cover image if uploaded
    let coverImageUrl: string | null = '/assets/bantahblue.svg'; // Default cover image
    if (req.file) {
      try {
        console.log(`📸 Processing cover image: ${req.file.originalname} (${req.file.size} bytes), mimetype: ${req.file.mimetype}`);
        // Convert buffer to base64 data URL
        const base64 = req.file.buffer.toString('base64');
        const mimeType = req.file.mimetype;
        coverImageUrl = `data:${mimeType};base64,${base64}`;
        
        console.log(`📸 Generated cover image URL for challenge ${challengeId}, length: ${coverImageUrl.length}`);
        
        // Update challenge with cover image URL
        const updateResult = await db
          .update(challenges)
          .set({ coverImageUrl })
          .where(eq(challenges.id, challengeId))
          .returning();
        
        if (updateResult.length === 0) {
          console.error(`❌ Failed to update cover image for challenge ${challengeId} - challenge not found`);
          throw new Error('Failed to save cover image');
        }
        
        console.log(`✅ Cover image saved for challenge ${challengeId}, update result:`, updateResult.length > 0 ? 'success' : 'failed');
      } catch (imageError) {
        console.error('❌ Failed to process cover image:', imageError);
        // Fall back to default cover image
        coverImageUrl = '/assets/bantahblue.svg';
        
        // Update with default
        await db
          .update(challenges)
          .set({ coverImageUrl })
          .where(eq(challenges.id, challengeId));
      }
    } else {
      console.log(`📸 No cover image uploaded for challenge ${challengeId}, using default`);
      
      // Set default cover image
      await db
        .update(challenges)
        .set({ coverImageUrl })
        .where(eq(challenges.id, challengeId));
    }

    // Award creation points to the creator IMMEDIATELY since tx is now required
    // and provided at creation time
    try {
      // Store creator transaction hash for traceability (already done above)
      await db.update(challenges).set({ onChainStatus: 'pending', creatorStaked: true }).where(eq(challenges.id, challengeId));

      const pointsWei = BigInt(Math.floor(creationPoints * 1e18));
      console.log(`🎁 Crediting ${creationPoints} Bantah Points to creator (tx: ${normalizedTx.substring(0, 10)}...)`);

      // Record points transaction in history
      await recordPointsTransaction({
        userId,
        challengeId: challengeId,
        transactionType: 'creation_reward',
        amount: Number(pointsWei),
        reason: `Created P2P challenge: "${title}"`,
        blockchainTxHash: normalizedTx,
        createdAt: new Date(),
      });

      // Update user's actual points balance
      await db.execute(sql`UPDATE users SET points = points + ${creationPoints} WHERE id = ${userId}`);

      // Sync the userPointsLedgers table with the updated balance
      await updateUserPointsBalance(userId);

      // Create transaction record for points earned
      await db.insert(transactions).values({
        userId,
        type: 'challenge_created',
        amount: creationPoints.toFixed(2),
        description: `Created challenge: "${title}"`,
        status: 'completed',
        createdAt: new Date(),
      });

      console.log(`✅ Points transaction recorded: ${creationPoints} points to creator`);
    } catch (pointsError) {
      console.error('❌ Failed to record creation points:', pointsError);
      if (pointsError instanceof Error) {
        console.error('   Error message:', pointsError.message);
        console.error('   Error stack:', pointsError.stack);
      }
      // Don't throw - continue even if points recording fails
    }

    // Send Point Earned notification to creator
    try {
      const pointsAmount = Number(creationPoints);
      await notificationService.send({
        userId: String(userId),
        challengeId: String(challengeId),
        event: NotificationEvent.POINTS_EARNED,
        title: '🎁 Points Earned!',
        body: `You earned ${pointsAmount} Bantah Points for creating "${title}"!`,
        channels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
        priority: NotificationPriority.MEDIUM,
        data: { actionUrl: `/wallet`, pointsEarned: pointsAmount, challengeId },
      });
    } catch (notifError) {
      console.error('Failed to send points notification to creator:', notifError);
    }

    // Send notifications:
    // - Open challenges: broadcast CHALLENGE_CREATED to active users (FCFS)
    // - Direct P2P: notify the specified opponent immediately (MATCH_FOUND)
    try {
      // Prepare common notification data with full challenge details
      const notificationData = {
        actionUrl: `/challenges/${challengeId}`,
        challengeId,
        challengeTitle: title,
        notificationType: 'challenge_received',
        stakeAmount: (parseInt(stakeAmount) / 2), // per-side stake
        totalPool: parseInt(stakeAmount),
        stakeAmountWei: BigInt(stakeAmount + '000000').toString(), // 6 decimals for USDC/USDT
        category: challengeType,
        challengerUser: {
          id: req.user?.id,
          username: req.user?.username,
          firstName: req.user?.firstName || 'Unknown',
          profileImageUrl: req.user?.profileImageUrl,
        },
      };

      if (isOpenChallenge) {
        const activeUsers = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.status, 'active'));

        for (const u of activeUsers) {
          try {
            await notificationService.send({
              userId: u.id,
              challengeId: String(challengeId),
              event: NotificationEvent.CHALLENGE_CREATED,
              title: '📊 New Market is available — be the first to accept!',
              body: `@${req.user?.username} created "${title}" — be the first to stake and win.`,
              channels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
              priority: NotificationPriority.MEDIUM,
              data: notificationData,
            });
          } catch (err) {
            console.error('Failed to send open-challenge notification to user', u.id, err);
          }
        }
      } else if (opponentId) {
        try {
          await notificationService.send({
            userId: opponentId,
            challengeId: String(challengeId),
            event: NotificationEvent.MATCH_FOUND,
            title: '🎯 New P2P Challenge!',
            body: `@${req.user?.username} challenged you to "${title}" — tap to accept or decline.`,
            channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
            priority: NotificationPriority.HIGH,
            data: notificationData,
          });
        } catch (err) {
          console.error('Failed to notify direct opponent', opponentId, err);
        }
      }
    } catch (err) {
      console.error('Error while dispatching challenge notifications:', err);
    }

    res.json({
      success: true,
      challengeId,
      message: 'Challenge created on-chain and saved to database. Ready for opponent to accept and match stakes!',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/challenges/:id/attach-tx
 * Attach a transaction hash to an existing challenge after off-chain creation.
 * Body: { transactionHash: string, role?: 'creator'|'acceptor' }
 */
router.patch('/:id/attach-tx', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const challengeId = parseInt(req.params.id);
    const userId = req.user?.id;
    const { transactionHash, role } = req.body || {};

    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    if (!transactionHash || typeof transactionHash !== 'string') return res.status(400).json({ error: 'Missing transactionHash' });

    const tx = transactionHash.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return res.status(400).json({ error: 'Invalid transactionHash format' });

    const dbChallenge = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
    if (!dbChallenge.length) return res.status(404).json({ error: 'Challenge not found' });

    const chall = dbChallenge[0];

    // Only allow creator to attach creator tx, acceptor to attach acceptor tx, or admins
    const isCreator = chall.challenger === userId;
    const isAcceptor = chall.challenged === userId;
    const userIsAdmin = req.user?.roles?.includes?.('admin');

    const effectiveRole = role === 'acceptor' ? 'acceptor' : (role === 'creator' ? 'creator' : (isCreator ? 'creator' : (isAcceptor ? 'acceptor' : null)));
    if (!effectiveRole) return res.status(403).json({ error: 'Not authorized to attach tx for this challenge' });
    if (effectiveRole === 'creator' && !isCreator && !userIsAdmin) return res.status(403).json({ error: 'Only creator or admin can attach creator tx' });
    if (effectiveRole === 'acceptor' && !isAcceptor && !userIsAdmin) return res.status(403).json({ error: 'Only acceptor or admin can attach acceptor tx' });

    const normalized = tx.toLowerCase();

    if (effectiveRole === 'creator') {
      await db.update(challenges).set({ creatorTransactionHash: normalized, creatorStaked: true, onChainStatus: chall.acceptorStaked ? 'matching' : 'pending' }).where(eq(challenges.id, challengeId));
      // Note: Points awarding is handled elsewhere when a validated tx is first stored.
    } else {
      await db.update(challenges).set({ acceptorTransactionHash: normalized, acceptorStaked: true, onChainStatus: chall.creatorStaked ? 'matching' : 'pending', challenged: chall.challenged || userId }).where(eq(challenges.id, challengeId));
    }

    // If both staked, activate
    const updated = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
    const uc = updated[0];
    if (uc.creatorStaked && uc.acceptorStaked) {
      const createdAt = uc.createdAt ? new Date(uc.createdAt).getTime() : Date.now();
      const origDue = uc.dueDate ? new Date(uc.dueDate).getTime() : createdAt + 24 * 60 * 60 * 1000;
      const origDuration = Math.max(origDue - createdAt, 15 * 60 * 1000);
      const newVotingEndsAt = new Date(Date.now() + origDuration);

      await db.update(challenges).set({ status: 'active', onChainStatus: 'active', votingEndsAt: newVotingEndsAt }).where(eq(challenges.id, challengeId));
    }

    res.json({ success: true, challengeId, attachedTo: effectiveRole, transactionHash: normalized });
  } catch (error: any) {
    console.error('Failed to attach tx:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/challenges/:id/accept-stake
 * Opponent accepts and stakes on-chain
 */
router.post('/:id/accept-stake', PrivyAuthMiddleware, async (req: Request, res: Response) => {

  /**
   * POST /api/challenges/:id/prepare-stake
   * Returns a prefilled transaction payload for the client wallet to sign
   * Body: { role?: 'creator'|'acceptor' } (optional) - server will infer when possible
   */
  router.post('/:id/prepare-stake', PrivyAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const challengeId = parseInt(req.params.id);
      const userId = req.user?.id;
      const { role } = req.body || {};

      if (!userId) return res.status(401).json({ error: 'Not authenticated' });

      const dbChallenge = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
      if (!dbChallenge.length) return res.status(404).json({ error: 'Challenge not found' });

      const challenge = dbChallenge[0];

      const client = getBlockchainClient();
      const factoryAddress = client.getContractAddresses().challengeFactory;

      // Determine role
      let effectiveRole: 'creator' | 'acceptor';
      if (role === 'creator' || role === 'acceptor') effectiveRole = role;
      else effectiveRole = (userId === challenge.challenger) ? 'creator' : 'acceptor';

      // Payment token and value
      const zeroAddr = '0x0000000000000000000000000000000000000000';
      const paymentToken = challenge.paymentTokenAddress || zeroAddr;
      const stakeWei = challenge.stakeAmountWei ? BigInt(challenge.stakeAmountWei) : BigInt(0);

      const iface = client.challengeFactoryContract.interface;

      if (effectiveRole === 'acceptor') {
        // Prepare acceptP2PChallenge(uint256 challengeId)
        const data = iface.encodeFunctionData('acceptP2PChallenge', [challengeId]);
        const value = (paymentToken.toLowerCase() === zeroAddr) ? '0x' + stakeWei.toString(16) : '0x0';

        return res.json({
          to: factoryAddress,
          data,
          value,
          chainId: (await client.getNetworkInfo()).chainId,
        });
      }

      // Creator: prepare createP2PChallenge(opponent, stakeAmount, paymentToken, metadataURI)
      if (!challenge.challenged) {
        return res.status(400).json({ error: 'No acceptor assigned yet for creator confirm' });
      }

      // Get primary wallet address of acceptor
      const primary = await dbGetUserPrimaryWallet(challenge.challenged);
      if (!primary || !primary.walletAddress) {
        return res.status(400).json({ error: 'Acceptor does not have a primary wallet address' });
      }

      const opponentAddr = primary.walletAddress;
      const metadataURI = '';
      const data = iface.encodeFunctionData('createP2PChallenge', [opponentAddr, stakeWei, paymentToken, metadataURI]);
      const value = (paymentToken.toLowerCase() === zeroAddr) ? '0x' + stakeWei.toString(16) : '0x0';

      return res.json({
        to: factoryAddress,
        data,
        value,
        chainId: (await client.getNetworkInfo()).chainId,
      });
    } catch (error: any) {
      console.error('Failed to prepare stake tx:', error);
      res.status(500).json({ error: error.message });
    }
  });
  try {
    const { transactionHash } = req.body;
    const challengeId = parseInt(req.params.id);
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    if (!transactionHash) return res.status(400).json({ error: 'Missing transactionHash' });

    const challenge = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
    if (!challenge.length) return res.status(404).json({ error: 'Challenge not found' });

    // Update acceptor status
    await db.update(challenges).set({
      challenged: userId,
      acceptorStaked: true,
      acceptorTransactionHash: transactionHash,
      onChainStatus: 'matching', // Someone has staked
    }).where(eq(challenges.id, challengeId));

    // If creator already staked, move to active and start countdown
    const updated = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
    const uc = updated[0];
    
    // Notify opponent that stakes are locked in escrow
    const stakedUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const stakedUserName = stakedUser[0]?.firstName || 'Someone';
    const stakeAmountFormatted = uc.amount ? `${uc.amount} pts` : 'Unknown amount';
    
    if (uc.challenged && uc.challenger) {
      const opponentId = uc.challenged === userId ? uc.challenger : uc.challenged;
      notifyEscrowLocked(opponentId, challengeId, stakeAmountFormatted, uc.title || `Challenge #${challengeId}`)
        .catch(err => console.warn('Failed to notify of escrow lock:', err?.message));
    }
    
    if (uc.creatorStaked && uc.acceptorStaked) {
      // compute original duration if set, otherwise default 24h
      const createdAt = uc.createdAt ? new Date(uc.createdAt).getTime() : Date.now();
      const origDue = uc.dueDate ? new Date(uc.dueDate).getTime() : createdAt + 24 * 60 * 60 * 1000;
      const origDuration = Math.max(origDue - createdAt, 15 * 60 * 1000); // min 15m
      const newVotingEndsAt = new Date(Date.now() + origDuration);

      await db.update(challenges).set({
        status: 'active',
        onChainStatus: 'active',
        votingEndsAt: newVotingEndsAt,
      }).where(eq(challenges.id, challengeId));

      // Notify both participants that challenge is active and chat is open
      try {
        notifyEscrowLocked(uc.challenger, challengeId, stakeAmountFormatted, uc.title || `Challenge #${challengeId}`)
          .catch((err: any) => console.warn('Failed to notify challenger of full escrow lock:', err?.message));
        if (uc.challenged) {
          notifyEscrowLocked(uc.challenged, challengeId, stakeAmountFormatted, uc.title || `Challenge #${challengeId}`)
            .catch((err: any) => console.warn('Failed to notify acceptor of full escrow lock:', err?.message));
        }
      } catch (notifyErr) {
        console.warn('Failed to notify participants of escrow lock:', notifyErr);
      }
    }

    res.json({ success: true, message: 'Stake recorded. Waiting for creator to confirm and stake.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/challenges/:id/creator-confirm-stake
 * Creator confirms and stakes on-chain after opponent has staked
 */
router.post('/:id/creator-confirm-stake', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { transactionHash } = req.body;
    const challengeId = parseInt(req.params.id);
    const userId = req.user?.id;

    const challenge = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
    if (!challenge.length) return res.status(404).json({ error: 'Challenge not found' });
    if (challenge[0].challenger !== userId) return res.status(403).json({ error: 'Only creator can confirm' });
    // Mark creator as staked
    await db.update(challenges).set({
      creatorStaked: true,
      creatorTransactionHash: transactionHash,
    }).where(eq(challenges.id, challengeId));

    // If acceptor already staked, activate and start countdown
    const updated = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
    const uc = updated[0];
    if (uc.acceptorStaked && uc.creatorStaked) {
      const createdAt = uc.createdAt ? new Date(uc.createdAt).getTime() : Date.now();
      const origDue = uc.dueDate ? new Date(uc.dueDate).getTime() : createdAt + 24 * 60 * 60 * 1000;
      const origDuration = Math.max(origDue - createdAt, 15 * 60 * 1000);
      const newVotingEndsAt = new Date(Date.now() + origDuration);

      await db.update(challenges).set({
        status: 'active',
        onChainStatus: 'active',
        votingEndsAt: newVotingEndsAt,
      }).where(eq(challenges.id, challengeId));
    }

/**
 * POST /api/challenges/:id/vote
 * Submit a vote for the outcome of the challenge
 */
router.post('/:id/vote', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { winnerId } = req.body; // userId of the winner or "draw"
    const challengeId = parseInt(req.params.id);
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    if (!winnerId) return res.status(400).json({ error: 'Missing winnerId' });

    const challenge = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
    if (!challenge.length) return res.status(404).json({ error: 'Challenge not found' });

    const c = challenge[0];
    const isChallenger = c.challenger === userId;
    const isAcceptor = c.challenged === userId;

    if (!isChallenger && !isAcceptor) return res.status(403).json({ error: 'Not a participant' });

    const updateData: any = {};
    if (isChallenger) updateData.creatorVote = winnerId;
    else updateData.acceptorVote = winnerId;

    await db.update(challenges).set(updateData).where(eq(challenges.id, challengeId));

    // Check if both have voted
    const updatedChallenge = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
    const uc = updatedChallenge[0];

    // Notify opponent that user voted
    const opponentId = isChallenger ? uc.challenged : uc.challenger;
    const voterUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const voterName = voterUser[0]?.firstName || 'Someone';
    const acceptorUser = uc.challenged ? await db.select().from(users).where(eq(users.id, uc.challenged)).limit(1) : null;
    
    if (opponentId && voterName) {
      notifyOpponentVoted(opponentId, challengeId, voterName, uc.title || `Challenge #${challengeId}`)
        .catch(err => console.warn('Failed to notify opponent of vote:', err?.message));
    }

    if (uc.creatorVote && uc.acceptorVote) {
      if (uc.creatorVote === uc.acceptorVote) {
        // Agreement! Settlement logic here (Escrow release would be triggered on-chain or via admin)
        await db.update(challenges).set({
          status: 'completed',
          result: uc.creatorVote === 'draw' ? 'draw' : (uc.creatorVote === uc.challenger ? 'challenger_won' : 'challenged_won'),
          completedAt: new Date(),
        }).where(eq(challenges.id, challengeId));
      } else {
        // Disagreement - mark as disputed
        await db.update(challenges).set({ status: 'disputed' }).where(eq(challenges.id, challengeId));
        
        // Notify both participants of dispute
        const disputeMsg = `Vote mismatch: Creator voted "${uc.creatorVote}", Acceptor voted "${uc.acceptorVote}"`;
        
        if (uc.challenger) {
          notifyDisputeRaised(uc.challenger, challengeId, uc.title || `Challenge #${challengeId}`, disputeMsg, voterName || 'System')
            .catch(err => console.warn('Failed to notify creator of dispute:', err?.message));
        }
        if (uc.challenged) {
          const otherVoterName = isChallenger ? (acceptorUser?.[0]?.firstName || 'Opponent') : voterName;
          notifyDisputeRaised(uc.challenged, challengeId, uc.title || `Challenge #${challengeId}`, disputeMsg, otherVoterName || 'System')
            .catch(err => console.warn('Failed to notify acceptor of dispute:', err?.message));
        }
      }
    }

    res.json({ success: true, message: 'Vote recorded.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/challenges/:id/proof
 * Submit proof for the outcome of the challenge
 */
router.post('/:id/proof', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { proof } = req.body; // URL or description
    const challengeId = parseInt(req.params.id);
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    if (!proof) return res.status(400).json({ error: 'Missing proof' });

    const challenge = await db.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1);
    if (!challenge.length) return res.status(404).json({ error: 'Challenge not found' });

    const isChallenger = challenge[0].challenger === userId;
    const isAcceptor = challenge[0].challenged === userId;

    if (!isChallenger && !isAcceptor) return res.status(403).json({ error: 'Not a participant' });

    const updateData: any = {};
    if (isChallenger) updateData.creatorProof = proof;
    else updateData.acceptorProof = proof;

    await db.update(challenges).set(updateData).where(eq(challenges.id, challengeId));

    // Notify opponent that proof was submitted
    const opponentId = isChallenger ? challenge[0].challenged : challenge[0].challenger;
    const submitterUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const submitterName = submitterUser[0]?.firstName || 'Someone';
    
    if (opponentId && submitterName) {
      notifyProofSubmitted(opponentId, challengeId, submitterName, challenge[0].title || `Challenge #${challengeId}`)
        .catch(err => console.warn('Failed to notify opponent of proof submission:', err.message));
    }

    res.json({ success: true, message: 'Proof submitted.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/challenges/:id/join
 * Join an admin challenge (choose YES or NO side)
 */
router.post('/:id/join', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { side } = req.body; // true for YES, false for NO
    const challengeId = parseInt(req.params.id);
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (side === undefined) {
      return res.status(400).json({
        error: 'Missing required field: side (true for YES, false for NO)',
      });
    }

    console.log(`\n🔗 User ${userId} joining challenge ${challengeId} on side ${side ? 'YES' : 'NO'}...`);

    // Get challenge
    const dbChallenge = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!dbChallenge.length) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = dbChallenge[0];

    // Calculate participation points using the new system (30 points fixed)
    const stakeAmountUSD = challenge.stakeAmountWei ? Number(challenge.stakeAmountWei) / 1e6 : 0; // Convert from wei to USD
    const participationPoints = calculateParticipationPoints(stakeAmountUSD);
    console.log(`🎁 Challenge participant will earn ${participationPoints} Bantah Points`);

    // Get on-chain challenge
    const onChainChallenge = await getChallenge(challengeId);

    // Join on-chain
    const txResult = await joinAdminChallenge(
      challengeId,
      side,
      req.user as any
    );

    // Record escrow
    if (challenge.stakeAmountWei) {
      await createEscrowRecord({
        challengeId,
        userId,
        tokenAddress: challenge.paymentTokenAddress!,
        amountEscrowed: challenge.stakeAmountWei,
        status: 'locked',
        side: side ? 'YES' : 'NO',
        lockTxHash: txResult.transactionHash,
      });
    }

    // Award participation points to the joining user
    try {
      const pointsInWei = BigInt(Math.floor(participationPoints * 1e18));
      
      // Update legacy points column in users table as well
      await db.update(users)
        .set({ points: sql`${users.points} + ${Math.floor(participationPoints)}` })
        .where(eq(users.id, userId));

      // Create transaction record
      await db.insert(transactions).values({
        userId,
        type: 'challenge_joined',
        amount: participationPoints.toFixed(2),
        description: `Joined challenge: "${challenge.title || `Challenge #${challengeId}`}"`,
        status: 'completed',
        createdAt: new Date(),
      });

      await recordPointsTransaction({
        userId,
        challengeId,
        transactionType: 'challenge_joined',
        amount: Number(pointsInWei),
        reason: `Participated in challenge #${challengeId}`,
        blockchainTxHash: txResult.transactionHash,
      });

      // Sync the userPointsLedgers table with the updated balance
      await updateUserPointsBalance(userId);

      console.log(`✅ Awarded ${participationPoints} points to user ${userId} for joining challenge`);
      
      // Send notification
      await notifyPointsEarnedParticipation(
        userId,
        challengeId,
        participationPoints,
        challenge.title || `Challenge #${challengeId}`
      ).catch(err => console.error('Failed to send participation points notification:', err));
    } catch (pointsError) {
      console.error('❌ Failed to record participation points:', pointsError);
      if (pointsError instanceof Error) {
        console.error('   Error message:', pointsError.message);
        console.error('   Error stack:', pointsError.stack);
      }
      // Don't fail the entire request if points recording fails
    }

    // Notify the challenge creator that someone joined their challenge (if it's an open challenge)
    if (!challenge.challenged && challenge.challenger) {
      try {
        const joiner = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        const joinerName = joiner[0]?.firstName || 'Someone';

        await notificationService.send({
          userId: challenge.challenger,
          challengeId: challengeId.toString(),
          event: NotificationEvent.CHALLENGE_JOINED_FRIEND,
          title: `👤 ${joinerName} joined your challenge!`,
          body: `${joinerName} has joined your open challenge: "${challenge.title}"`,
          channels: [NotificationChannel.IN_APP, NotificationChannel.PUSH],
          priority: NotificationPriority.MEDIUM,
          data: {
            challengeId: challengeId,
            title: challenge.title,
            joinerId: userId,
            joinerName: joinerName,
          },
        }).catch(err => {
          console.warn('Failed to notify creator that someone joined:', err.message);
        });

        console.log(`📬 Creator ${challenge.challenger} notified that ${joinerName} joined their challenge`);
      } catch (err) {
        console.error('Failed to send join notification to creator:', err);
      }
    }

    console.log(`✅ User joined challenge: ${txResult.transactionHash}`);

    res.json({
      success: true,
      challengeId,
      transactionHash: txResult.transactionHash,
      side: side ? 'YES' : 'NO',
    });
  } catch (error: any) {
    console.error('Failed to join challenge:', error);
    res.status(500).json({
      error: 'Failed to join challenge',
      message: error.message,
    });
  }
});

/**
 * POST /api/challenges/:id/accept
 * Accept a P2P challenge (as the challenged user)
 */
router.post('/:id/accept', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const challengeId = parseInt(req.params.id);
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log(`\n🤝 User ${userId} accepting P2P challenge ${challengeId}...`);

    // Get challenge
    const dbChallenge = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!dbChallenge.length) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = dbChallenge[0];

    if (challenge.challenged !== userId) {
      return res.status(403).json({
        error: 'Not the challenged user',
      });
    }

    // DEPRECATED: server-side on-chain acceptance has been removed.
    // Clients MUST perform the on-chain `acceptP2PChallenge` transaction
    // using the user's wallet, then POST the resulting transaction hash
    // to `/api/challenges/:id/accept-stake` so the backend can record it.

    return res.status(410).json({
      error: 'Deprecated endpoint',
      message: 'Server-side on-chain accept removed. Call accept on-chain from the client, then POST /api/challenges/:id/accept-stake with the transactionHash.',
    });
  } catch (error: any) {
    console.error('Failed to accept challenge:', error);
    res.status(500).json({
      error: 'Failed to accept challenge',
      message: error.message,
    });
  }
});

/**
 * GET /api/challenges/:id
 * Get challenge details with on-chain data
 */
router.get('/:id', async (req: Request, res: Response) => {
  const challengeId = parseInt(req.params.id);
  console.log(`⚡⚡⚡ [GET /api/challenges/:id] HANDLER CALLED! ID: ${req.params.id}, parsed: ${challengeId}`);
  
  try {
    console.log(`[GET /api/challenges/:id] Fetching challenge ID: ${req.params.id}, parsed as: ${challengeId}`);

    // Get from database
    const dbChallenge = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!dbChallenge.length) {
      console.log(`[GET /api/challenges/:id] Challenge ID ${challengeId} not found in database`);
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = dbChallenge[0];

    // Get user data with primary wallet addresses
    let challengerUser = null;
    let challengedUser = null;

    if (challenge.challenger) {
      const userData = await db
        .select({
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
        })
        .from(users)
        .where(eq(users.id, challenge.challenger));

      if (userData.length > 0) {
        const primaryWallet = await dbGetUserPrimaryWallet(challenge.challenger);
        challengerUser = {
          ...userData[0],
          primaryWalletAddress: primaryWallet?.walletAddress || null,
        };
      }
    }

    if (challenge.challenged) {
      const userData = await db
        .select({
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
        })
        .from(users)
        .where(eq(users.id, challenge.challenged));

      if (userData.length > 0) {
        const primaryWallet = await dbGetUserPrimaryWallet(challenge.challenged);
        challengedUser = {
          ...userData[0],
          primaryWalletAddress: primaryWallet?.walletAddress || null,
        };
      }
    }

    // Get on-chain data
    let onChainData = null;
    let participants = null;

    try {
      onChainData = await getChallenge(challengeId);
      participants = await getChallengeParticipants(challengeId);
    } catch (error) {
      console.warn('Could not fetch on-chain data:', error);
    }

    // Compute chat gating: chat opens only when both parties have staked and status is active
    const now = Date.now();
    const chatOpen = Boolean(challenge.creatorStaked && challenge.acceptorStaked && challenge.status === 'active');
    let countdownSeconds = null;
    if (chatOpen && challenge.votingEndsAt) {
      const ends = new Date(challenge.votingEndsAt).getTime();
      countdownSeconds = Math.max(0, Math.floor((ends - now) / 1000));
    }

    res.json({
      ...challenge,
      challengerUser,
      challengedUser,
      onChainData,
      participants,
      chatOpen,
      countdownSeconds,
      votingEndsAt: challenge.votingEndsAt || null,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get challenge',
      message: error.message,
    });
  }
});

/**
 * GET /api/challenges
 * List challenges with filters
 */
router.get('/', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { status, adminCreated, limit = 50, offset = 0 } = req.query;

    // First get the challenges
    let query = db.select().from(challenges);

    if (status) {
      query = query.where(eq(challenges.status, status as string));
    }

    if (adminCreated !== undefined) {
      query = query.where(eq(challenges.adminCreated, adminCreated === 'true'));
    }

    const challengeResults = await query
      .limit(parseInt(limit as string))
      .offset(parseInt(offset as string));

    // Get unique user IDs from the challenges
    const userIds = new Set<string>();
    challengeResults.forEach(challenge => {
      if (challenge.challenger) userIds.add(challenge.challenger);
      if (challenge.challenged) userIds.add(challenge.challenged);
    });

    // Fetch user data for all unique user IDs
    const usersData = await db
      .select({
        id: users.id,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
      })
      .from(users)
      .where(inArray(users.id, Array.from(userIds)));

    // Get primary wallet addresses for all users
    const userMap = new Map();
    for (const user of usersData) {
      const primaryWallet = await dbGetUserPrimaryWallet(user.id);
      userMap.set(user.id, {
        ...user,
        primaryWalletAddress: primaryWallet?.walletAddress || null,
      });
    }

    // Combine challenge data with user data
    const challengesWithUsers = challengeResults.map(challenge => ({
      ...challenge,
      challengerUser: challenge.challenger ? userMap.get(challenge.challenger) : null,
      challengedUser: challenge.challenged ? userMap.get(challenge.challenged) : null,
    }));

    res.json({
      challenges: challengesWithUsers,
      total: challengeResults.length,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to list challenges',
      message: error.message,
    });
  }
});

/**
 * GET /api/challenges/user/:userId
 * Get user's challenges
 */
router.get('/user/:userId', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const userChallenges = await db
      .select()
      .from(challenges)
      .where(
        // Challenges where user is challenger or challenged
        db.raw(
          `(challenger = $1 OR challenged = $1)`
        )
      )
      .orderBy(challenges.createdAt);

    // Get unique user IDs from the challenges
    const userIds = new Set<string>();
    userChallenges.forEach(challenge => {
      if (challenge.challenger) userIds.add(challenge.challenger);
      if (challenge.challenged) userIds.add(challenge.challenged);
    });

    // Fetch user data for all unique user IDs
    const usersData = await db
      .select({
        id: users.id,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
      })
      .from(users)
      .where(inArray(users.id, Array.from(userIds)));

    // Get primary wallet addresses for all users
    const userMap = new Map();
    for (const user of usersData) {
      const primaryWallet = await dbGetUserPrimaryWallet(user.id);
      userMap.set(user.id, {
        ...user,
        primaryWalletAddress: primaryWallet?.walletAddress || null,
      });
    }

    // Combine challenge data with user data
    const challengesWithUsers = userChallenges.map(challenge => ({
      ...challenge,
      challengerUser: challenge.challenger ? userMap.get(challenge.challenger) : null,
      challengedUser: challenge.challenged ? userMap.get(challenge.challenged) : null,
    }));

    res.json({
      challenges: challengesWithUsers,
      total: challengesWithUsers.length,
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to get user challenges',
      message: error.message,
    });
  }
});

/**
 * POST /api/challenges/:challengeId/accept-open
 * Accept an open P2P challenge (first user to join becomes opponent)
 * Acceptor's side is auto-assigned as opposite of creator's side
 */
router.post('/:challengeId/accept-open', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { challengeId } = req.params;
    const userId = req.user?.id;
    const { side: providedSide } = req.body; // Should be YES or NO

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log(`\n⚔️ User ${userId} accepting open challenge ${challengeId} on side ${providedSide}...`);

    // Get challenge from database
    const dbChallenge = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, parseInt(challengeId)))
      .limit(1);

    if (!dbChallenge.length) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = dbChallenge[0];

    // Validate challenge is open and waiting for opponent
    if (challenge.status !== 'open') {
      return res.status(400).json({
        error: `Challenge is not open. Current status: ${challenge.status}`,
      });
    }

    if (challenge.challenged !== null) {
      return res.status(400).json({
        error: 'Challenge has already been accepted by someone else',
      });
    }

    // Validate user is not the creator
    if (challenge.challenger === userId) {
      return res.status(403).json({
        error: 'You cannot accept your own challenge',
      });
    }

    // Validate side is correct (should be opposite of creator's side)
    const creatorSide = challenge.challengerSide || 'YES';
    const acceptorSide = providedSide || (creatorSide === 'YES' ? 'NO' : 'YES');
    
    if (acceptorSide === creatorSide) {
      return res.status(400).json({
        error: `Creator chose ${creatorSide}. You must choose ${creatorSide === 'YES' ? 'NO' : 'YES'}`,
      });
    }

    console.log(`✅ Challenge validation passed. Creator: ${creatorSide}, Acceptor: ${acceptorSide}. Updating database...`);

    // For now, we update the DB first to mark it as active
    const { transactionHash: providedTxHash } = req.body;

    // Step 2: Update database with acceptor info and acceptor's side
    await db
      .update(challenges)
      .set({
        challenged: userId,
        status: 'active',
        acceptorTransactionHash: providedTxHash || 'pending_onchain',
        acceptorStaked: true, // Mark acceptor as having staked
      })
      .where(eq(challenges.id, parseInt(challengeId)));

    console.log(`✅ Database updated - challenge now ACTIVE`);

    // Step 3: Create escrow records for both creator and acceptor
    console.log(`🔒 Creating escrow records for both participants...`);
    
    if (challenge.stakeAmountWei) {
      // Creator escrow
      await createEscrowRecord({
        challengeId: parseInt(challengeId),
        userId: challenge.challenger!,
        tokenAddress: challenge.paymentTokenAddress!,
        amountEscrowed: challenge.stakeAmountWei,
        status: 'locked',
        side: creatorSide,
        lockTxHash: providedTxHash || 'pending_onchain',
      }).catch(err => console.warn('Failed to create creator escrow:', err));

      // Acceptor escrow
      await createEscrowRecord({
        challengeId: parseInt(challengeId),
        userId: userId,
        tokenAddress: challenge.paymentTokenAddress!,
        amountEscrowed: challenge.stakeAmountWei,
        status: 'locked',
        side: acceptorSide,
        lockTxHash: providedTxHash || 'pending_onchain',
      }).catch(err => console.warn('Failed to create acceptor escrow:', err));
      
      console.log(`✅ Escrow records created for both participants`);
    }

    // Step 4: Get the creator for notifications
    const creator = await db
      .select()
      .from(users)
      .where(eq(users.id, challenge.challenger!))
      .limit(1);

    const acceptor = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const creatorName = creator[0]?.firstName || 'Someone';
    const acceptorName = acceptor[0]?.firstName || 'Someone';

    // Step 5: Send notifications
    console.log(`📬 Sending notifications...`);

    // Notify both participants that challenge is now active
    const durationHours = Math.ceil((challenge.dueDate ? (challenge.dueDate.getTime() - new Date().getTime()) / (1000 * 60 * 60) : 24));
    await notifyChallengeActivated(challenge.challenger!, challengeId, acceptorName, challenge.title || `Challenge #${challengeId}`, durationHours)
      .catch(err => console.warn('Failed to notify creator of challenge activation:', err?.message));
    
    await notifyChallengeActivated(userId, challengeId, creatorName, challenge.title || `Challenge #${challengeId}`, durationHours)
      .catch(err => console.warn('Failed to notify acceptor of challenge activation:', err?.message));

    // Notify creator that someone accepted their challenge
    await notificationService.sendNotification({
      userId: challenge.challenger!,
      event: NotificationEvent.NEW_CHALLENGE_ACCEPTED,
      title: '⚔️ Challenge Accepted!',
      message: `${acceptorName} accepted your challenge! The battle begins now.`,
      metadata: {
        challengeId: parseInt(challengeId),
        challengeTitle: challenge.title,
        acceptorId: userId,
        acceptorName: acceptorName,
        // `challenge.amount` is the total pool (both sides). Send per-side stake here.
        stakeAmount: (challenge.amount / 2),
        challengeType: 'open',
      },
      channels: [NotificationChannel.PUSHER, NotificationChannel.FIREBASE],
      priority: NotificationPriority.HIGH,
    }).catch(err => {
      console.warn('⚠️ Notification to creator failed (non-blocking):', err.message);
    });

    // Notify acceptor that they joined the challenge
    await notificationService.sendNotification({
      userId: userId,
      event: NotificationEvent.NEW_CHALLENGE_ACCEPTED,
      title: '✓ Challenge Accepted!',
      message: `You've accepted ${creatorName}'s challenge! Stakes are now locked on-chain. May the best predictor win!`,
      metadata: {
        challengeId: parseInt(challengeId),
        challengeTitle: challenge.title,
        creatorId: challenge.challenger,
        creatorName: creatorName,
        // `challenge.amount` is total pool; provide per-side stake and explicit totalPool
        stakeAmount: (challenge.amount / 2),
        totalPool: challenge.amount,
        challengeType: 'open',
      },
      channels: [NotificationChannel.PUSHER, NotificationChannel.FIREBASE],
      priority: NotificationPriority.HIGH,
    }).catch(err => {
      console.warn('⚠️ Notification to acceptor failed (non-blocking):', err.message);
    });

    // Award Bantah Points for joining
    const stakePerSideUSD = (challenge.amount / 2); // Per-side stake amount
    const joiningPoints = calculateParticipationPoints(stakePerSideUSD);
    const pointsWei = BigInt(joiningPoints) * BigInt(1e18);
    
    await recordPointsTransaction({
      userId: userId,
      transactionType: 'joining_reward',
      amount: pointsWei,
      reason: `Joining challenge: ${challenge.title}`,
      challengeId: parseInt(challengeId)
    }).catch(err => console.error('Failed to award joining points:', err));

    // Update legacy points column for leaderboard sync
    await db.execute(sql`UPDATE users SET points = points + ${joiningPoints} WHERE id = ${userId}`);

    // Sync the userPointsLedgers table with the updated balance
    await updateUserPointsBalance(userId).catch(err => console.error('Failed to sync points ledger:', err));

    console.log(`✅ Notifications sent successfully`);

    // Step 6: Return success response with chat URL
    res.json({
      success: true,
      challengeId: parseInt(challengeId),
      transactionHash: providedTxHash || 'pending_onchain',
      blockNumber: null,
      status: 'active',
      title: challenge.title,
      challenger: challenge.challenger,
      challenged: userId,
      creatorSide: creatorSide,
      acceptorSide: acceptorSide,
      // Return per-side stake and the total pool correctly
      stakeAmount: (challenge.amount / 2),
      totalPool: challenge.amount,
      pointsAwarded: joiningPoints,
      chatUrl: `/chat/${parseInt(challengeId)}`, // For automatic chat redirect
      message: `Challenge accepted! Both stakes are now locked on-chain.`,
    });

  } catch (error: any) {
    console.error('❌ Failed to accept open challenge:', error);
    
    // Determine error type
    let errorMessage = error.message || 'Failed to accept challenge';
    let statusCode = 500;

    if (error.message?.includes('already accepted')) {
      errorMessage = 'This challenge has already been accepted by someone else';
      statusCode = 409;
    } else if (error.message?.includes('Challenge not open')) {
      errorMessage = 'This challenge is no longer open';
      statusCode = 400;
    } else if (error.message?.includes('insufficient')) {
      errorMessage = 'Insufficient USDC balance to accept this challenge';
      statusCode = 400;
    }

    res.status(statusCode).json({
      error: 'Challenge acceptance failed',
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * POST /api/challenges/:challengeId/evidence
 * Submit evidence for a P2P challenge
 * Users can submit proof to support their position before or after dispute
 */
router.post('/:challengeId/evidence', PrivyAuthMiddleware, upload.array('files', 5), async (req: Request, res: Response) => {
  try {
    const { challengeId } = req.params;
    const userId = req.user?.id;
    const { description, type } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Evidence description is required' });
    }

    const id = parseInt(challengeId);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid challenge ID' });
    }

    console.log(`\n📸 User ${userId} submitting evidence for challenge ${id}...`);

    // Get challenge
    const dbChallenge = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, id))
      .limit(1);

    if (!dbChallenge.length) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = dbChallenge[0];

    // Verify user is participant
    if (challenge.challenger !== userId && challenge.challenged !== userId) {
      return res.status(403).json({ error: 'You are not a participant in this challenge' });
    }

    // Challenge must be active or completed (can submit evidence before or after)
    if (!['active', 'completed', 'disputed'].includes(challenge.status)) {
      return res.status(400).json({
        error: 'Cannot submit evidence for this challenge',
        currentStatus: challenge.status,
      });
    }

    // Collect file data
    const files = req.files as Express.Multer.File[] | undefined;
    const fileCount = files ? files.length : 0;

    if (fileCount === 0) {
      return res.status(400).json({ error: 'At least one file is required' });
    }

    if (fileCount > 5) {
      return res.status(400).json({ error: 'Maximum 5 files allowed' });
    }

    // Create evidence object
    const evidenceData = {
      submittedBy: userId,
      submittedAt: new Date().toISOString(),
      description: description.trim(),
      type: type || 'p2p_evidence',
      files: files?.map((f) => ({
        originalName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
        buffer: f.buffer.toString('base64'), // Store as base64
        fieldname: f.fieldname,
      })) || [],
    };

    // Update challenge with evidence
    await db
      .update(challenges)
      .set({
        evidence: evidenceData,
      })
      .where(eq(challenges.id, id));

    console.log(`✅ Evidence submitted for challenge ${id}`);
    console.log(`   Files: ${fileCount}`);
    console.log(`   Description: ${description.substring(0, 50)}...`);

    // Notify admins about evidence submission
    await notificationService
      .sendNotification({
        type: NotificationEvent.EVIDENCE_SUBMITTED,
        userId: 'admin', // Target admins
        title: `📸 Evidence Submitted - Challenge #${id}`,
        message: `${challenge.challengerUser?.firstName || challenge.challenger} submitted evidence for "${challenge.title}"`,
        data: {
          challengeId: id,
          submittedBy: userId,
          submittedByName: challenge.challenger === userId ? challenge.challengerUser?.firstName : challenge.challengedUser?.firstName,
          challengeTitle: challenge.title,
          fileCount,
        },
        channels: [NotificationChannel.PUSHER, NotificationChannel.FIREBASE],
        priority: NotificationPriority.HIGH,
      })
      .catch((err) => {
        console.warn('⚠️  Failed to notify admin about evidence submission:', err.message);
      });

    // Also notify the other participant
    const otherUserId = challenge.challenger === userId ? challenge.challenged : challenge.challenger;
    if (otherUserId) {
      await notificationService
        .sendNotification({
          type: NotificationEvent.CHALLENGE_UPDATE,
          userId: otherUserId,
          title: 'Evidence Submitted',
          message: 'Your opponent submitted evidence for this challenge. An admin will review it.',
          data: {
            challengeId: id,
            challengeTitle: challenge.title,
          },
          channels: [NotificationChannel.PUSHER],
          priority: NotificationPriority.MEDIUM,
        })
        .catch((err) => {
          console.warn('⚠️  Failed to notify other participant:', err.message);
        });
    }

    res.json({
      success: true,
      challengeId: id,
      message: 'Evidence submitted successfully',
      evidenceData: {
        submittedBy: userId,
        submittedAt: evidenceData.submittedAt,
        description: description.trim(),
        fileCount,
      },
    });
  } catch (error: any) {
    console.error('❌ Failed to submit evidence:', error);
    res.status(500).json({
      error: 'Failed to submit evidence',
      message: error.message,
    });
  }
});

    if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });

    await notificationService.send({
      userId: String(targetUserId),
      challengeId: null as any,
      event: NotificationEvent.CHALLENGE_CREATED,
      title: title || 'Debug Notification',
      body: body || 'This is a server-triggered debug notification',
      channels: [NotificationChannel.IN_APP],
      priority: NotificationPriority.MEDIUM,
      data: { debug: true },
    });

    res.json({ success: true, message: 'Notification triggered' });
  } catch (err: any) {
    console.error('Failed to trigger debug notification:', err);
    res.status(500).json({ error: err.message || 'Failed to trigger notification' });
  }
});

/**
 * GET /api/challenges/:challengeId/messages
 * Get all messages for a challenge
 */
router.get('/:challengeId/messages', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { challengeId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const id = parseInt(challengeId);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid challenge ID' });
    }

    // Verify user has access to this challenge
    const dbChallenge = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, id))
      .limit(1);

    if (!dbChallenge.length) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = dbChallenge[0];

    // Check if user is a participant or if it's an admin-created challenge
    if (challenge.challenger !== userId && challenge.challenged !== userId && challenge.adminCreated !== true) {
      return res.status(403).json({ error: 'You do not have access to this challenge' });
    }

    // Get messages
    const { challengeMessages } = await import('../../shared/schema');
    const messages = await db
      .select({
        id: challengeMessages.id,
        challengeId: challengeMessages.challengeId,
        userId: challengeMessages.userId,
        message: challengeMessages.message,
        createdAt: challengeMessages.createdAt,
        user: {
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          profileImageUrl: users.profileImageUrl,
        },
      })
      .from(challengeMessages)
      .leftJoin(users, eq(challengeMessages.userId, users.id))
      .where(eq(challengeMessages.challengeId, id))
      .orderBy(challengeMessages.createdAt);

    res.json(messages);
  } catch (error: any) {
    console.error('Failed to get challenge messages:', error);
    res.status(500).json({ error: 'Failed to get messages', message: error.message });
  }
});

/**
 * POST /api/challenges/:challengeId/messages
 * Send a message to a challenge chat
 */
router.post('/:challengeId/messages', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { challengeId } = req.params;
    const userId = req.user?.id;
    const { message } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const id = parseInt(challengeId);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid challenge ID' });
    }

    // Verify user has access to this challenge
    const dbChallenge = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, id))
      .limit(1);

    if (!dbChallenge.length) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = dbChallenge[0];

    // Check if user is a participant or if it's an admin-created challenge
    if (challenge.challenger !== userId && challenge.challenged !== userId && challenge.adminCreated !== true) {
      return res.status(403).json({ error: 'You do not have access to this challenge' });
    }

    // Save message to database
    const { challengeMessages } = await import('../../shared/schema');
    const [newMessage] = await db
      .insert(challengeMessages)
      .values({
        challengeId: id,
        userId: userId,
        message: message.trim(),
        createdAt: new Date(),
      })
      .returning();

    // Get user info for the response
    const userInfo = await db
      .select({
        id: users.id,
        username: users.username,
        firstName: users.firstName,
        profileImageUrl: users.profileImageUrl,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const messageWithUser = {
      ...newMessage,
      user: userInfo[0] || null,
    };

    // Notify opponent about new message
    const opponentId = challenge.challenger === userId ? challenge.challenged : challenge.challenger;
    const senderName = userInfo[0]?.firstName || 'Opponent';
    
    if (opponentId) {
      notifyNewChatMessage(
        opponentId,
        id,
        senderName,
        message.trim().substring(0, 100), // First 100 chars of message
        challenge.title || `Challenge #${id}`
      ).catch(err => console.warn('Failed to notify of new chat message:', err?.message));
    }

    // Send real-time notification - for now just respond with the message
    // In-app Pusher notification will be sent via notifyNewChatMessage above
    res.json(messageWithUser);
  } catch (error: any) {
    console.error('Failed to send challenge message:', error);
    res.status(500).json({ error: 'Failed to send message', message: error.message });
  }
});

/**
 * POST /api/challenges/:id/lock-creator-stake
 * Creator locks their stake after acceptor has already locked theirs
 * Only called after challenge is in "active" status with acceptor staked
 */
router.post('/:id/lock-creator-stake', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const challengeId = parseInt(req.params.id);
    const userId = req.user?.id;
    const { transactionHash } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log(`\n🔒 Creator ${userId} locking stake for challenge ${challengeId}...`);

    // Get challenge
    const dbChallenge = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!dbChallenge.length) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = dbChallenge[0];

    // Verify user is the creator
    if (challenge.challenger !== userId) {
      return res.status(403).json({ error: 'Only the challenge creator can lock their stake' });
    }

    // Verify acceptor has already staked
    if (!challenge.acceptorStaked) {
      return res.status(400).json({ error: 'Acceptor has not staked yet' });
    }

    // Verify creator hasn't already staked
    if (challenge.creatorStaked) {
      return res.status(400).json({ error: 'You have already locked your stake' });
    }

    // Verify status is "active"
    if (challenge.status !== 'active') {
      return res.status(400).json({ error: 'Challenge is not in active status' });
    }

    console.log(`✅ Validation passed. Updating challenge status...`);

    // Update challenge: mark creator as staked
    await db
      .update(challenges)
      .set({
        creatorStaked: true,
        creatorTransactionHash: transactionHash || 'pending_onchain',
        blockchainCreatedAt: new Date(),
      })
      .where(eq(challenges.id, challengeId));

    // Create escrow record for creator if not already exists
    const existingEscrow = await db
      .select()
      .from(challengeEscrowRecords)
      .where(
        and(
          eq(challengeEscrowRecords.challengeId, challengeId),
          eq(challengeEscrowRecords.userId, userId)
        )
      )
      .limit(1);

    if (!existingEscrow.length && challenge.stakeAmountWei) {
      await createEscrowRecord({
        challengeId,
        userId,
        tokenAddress: challenge.paymentTokenAddress!,
        amountEscrowed: challenge.stakeAmountWei,
        status: 'locked',
        side: challenge.challengerSide || 'YES',
        lockTxHash: transactionHash || 'pending_onchain',
      });
    }

    console.log(`✅ Creator stake locked. Both stakes now confirmed on-chain.`);

    // Notify acceptor that creator has locked their stake
    const creator = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const creatorName = creator[0]?.firstName || 'The creator';

    // Get acceptor
    const acceptor = await db
      .select()
      .from(users)
      .where(eq(users.id, challenge.challenged!))
      .limit(1);

    await notificationService.sendNotification({
      userId: challenge.challenged!,
      event: NotificationEvent.NEW_CHALLENGE_ACCEPTED,
      title: '🔒 Stakes Locked!',
      message: `${creatorName} has locked their stake. Both stakes are now on-chain. Let the dispute begin!`,
      metadata: {
        challengeId: challengeId,
        challengeTitle: challenge.title,
        creatorId: userId,
        creatorName: creatorName,
        challengeType: 'p2p',
      },
      channels: [NotificationChannel.PUSHER, NotificationChannel.FIREBASE],
      priority: NotificationPriority.HIGH,
    }).catch(err => {
      console.warn('⚠️ Failed to notify acceptor:', err.message);
    });

    res.json({
      success: true,
      challengeId,
      transactionHash: transactionHash || 'pending_onchain',
      status: 'both_staked',
      message: 'Your stake is now locked! Dispute period has begun.',
      chatUrl: `/chat/${challengeId}`,
    });

  } catch (error: any) {
    console.error('❌ Failed to lock creator stake:', error);
    res.status(500).json({
      error: 'Failed to lock stake',
      message: error.message,
    });
  }
});

/**
 * POST /api/challenges/:id/request-refund
 * One party requests a mutual refund (only available after stakes are locked)
 */
router.post('/:id/request-refund', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const challengeId = parseInt(req.params.id);
    const userId = req.user?.id;
    const { reason } = req.body; // Optional: why they want refund

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log(`\n💰 User ${userId} requesting refund for challenge ${challengeId}...`);

    // Get challenge
    const dbChallenge = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!dbChallenge.length) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = dbChallenge[0];

    // Verify user is one of the participants
    if (challenge.challenger !== userId && challenge.challenged !== userId) {
      return res.status(403).json({ error: 'You are not a participant in this challenge' });
    }

    // Verify both stakes are locked (can only refund if both are committed)
    if (!challenge.creatorStaked || !challenge.acceptorStaked) {
      return res.status(400).json({ error: 'Both participants must lock their stakes before requesting refund' });
    }

    // Check if already in dispute or completed
    if (challenge.status === 'completed' || challenge.status === 'cancelled') {
      return res.status(400).json({ error: `Cannot refund a ${challenge.status} challenge` });
    }

    // Update challenge with dispute reason and mark as disputed
    const isCreator = challenge.challenger === userId;
    const opponent = isCreator ? challenge.challenged : challenge.challenger;

    await db
      .update(challenges)
      .set({
        status: 'disputed',
        disputeReason: reason || 'Mutual refund requested',
      })
      .where(eq(challenges.id, challengeId));

    console.log(`✅ Refund requested. Status changed to "disputed".`);

    // Notify opponent about refund request
    const requester = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const requesterName = requester[0]?.firstName || 'Someone';

    await notificationService.sendNotification({
      userId: opponent!,
      event: NotificationEvent.NEW_CHALLENGE_ACCEPTED, // Reusing event type
      title: '💰 Refund Requested',
      message: `${requesterName} has requested a mutual refund. You can agree or decline in the chat.`,
      metadata: {
        challengeId: challengeId,
        challengeTitle: challenge.title,
        requesterId: userId,
        requesterName: requesterName,
      },
      channels: [NotificationChannel.PUSHER, NotificationChannel.FIREBASE],
      priority: NotificationPriority.HIGH,
    }).catch(err => {
      console.warn('⚠️ Failed to notify opponent of refund request:', err.message);
    });

    res.json({
      success: true,
      challengeId,
      message: 'Refund request sent to your opponent. Awaiting their response.',
      opponent: {
        id: opponent,
        name: (await db.select().from(users).where(eq(users.id, opponent!)).limit(1))[0]?.firstName,
      },
    });

  } catch (error: any) {
    console.error('❌ Failed to request refund:', error);
    res.status(500).json({
      error: 'Failed to request refund',
      message: error.message,
    });
  }
});

/**
 * POST /api/challenges/:id/accept-refund
 * Opponent agrees to mutual refund - both get funds released from escrow
 */
router.post('/:id/accept-refund', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const challengeId = parseInt(req.params.id);
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log(`\n✅ User ${userId} accepting refund for challenge ${challengeId}...`);

    // Get challenge
    const dbChallenge = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!dbChallenge.length) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = dbChallenge[0];

    // Verify user is the opponent (not the one who requested)
    if (challenge.challenger !== userId && challenge.challenged !== userId) {
      return res.status(403).json({ error: 'You are not a participant in this challenge' });
    }

    // Verify status is disputed
    if (challenge.status !== 'disputed') {
      return res.status(400).json({ error: 'Challenge is not in disputed status' });
    }

    console.log(`✅ Refund accepted. Releasing escrow for both participants...`);

    // Update challenge status to cancelled (mutual refund = cancelled)
    await db
      .update(challenges)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
      })
      .where(eq(challenges.id, challengeId));

    // Release both escrow records
    await db
      .update(challengeEscrowRecords)
      .set({
        status: 'released',
        releasedAt: new Date(),
      })
      .where(eq(challengeEscrowRecords.challengeId, challengeId));

    console.log(`✅ Both escrows released. Funds returned to participants.`);

    // Notify both parties
    const creator = await db.select().from(users).where(eq(users.id, challenge.challenger!)).limit(1);
    const acceptor = await db.select().from(users).where(eq(users.id, challenge.challenged!)).limit(1);
    const acceptorName = acceptor[0]?.firstName || 'Someone';
    const creatorName = creator[0]?.firstName || 'Someone';

    // Notify creator
    await notificationService.sendNotification({
      userId: challenge.challenger!,
      event: NotificationEvent.NEW_CHALLENGE_ACCEPTED,
      title: '💰 Refund Accepted',
      message: `${acceptorName} accepted the mutual refund. Your full stake has been returned.`,
      metadata: {
        challengeId: challengeId,
        challengeTitle: challenge.title,
      },
      channels: [NotificationChannel.PUSHER, NotificationChannel.FIREBASE],
      priority: NotificationPriority.MEDIUM,
    }).catch(err => {
      console.warn('⚠️ Failed to notify creator of accepted refund:', err.message);
    });

    // Notify acceptor
    await notificationService.sendNotification({
      userId: challenge.challenged!,
      event: NotificationEvent.NEW_CHALLENGE_ACCEPTED,
      title: '💰 Refund Completed',
      message: `You accepted the mutual refund with ${creatorName}. Your full stake has been returned.`,
      metadata: {
        challengeId: challengeId,
        challengeTitle: challenge.title,
      },
      channels: [NotificationChannel.PUSHER, NotificationChannel.FIREBASE],
      priority: NotificationPriority.MEDIUM,
    }).catch(err => {
      console.warn('⚠️ Failed to notify acceptor of completed refund:', err.message);
    });

    res.json({
      success: true,
      challengeId,
      status: 'refunded',
      message: 'Mutual refund completed! Full stakes returned to both participants.',
    });

  } catch (error: any) {
    console.error('❌ Failed to accept refund:', error);
    res.status(500).json({
      error: 'Failed to accept refund',
      message: error.message,
    });
  }
});

/**
 * POST /api/challenges/:id/decline-refund
 * Opponent declines refund request - challenge continues to dispute resolution
 */
router.post('/:id/decline-refund', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const challengeId = parseInt(req.params.id);
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log(`\n❌ User ${userId} declining refund for challenge ${challengeId}...`);

    // Get challenge
    const dbChallenge = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!dbChallenge.length) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = dbChallenge[0];

    // Verify user is a participant
    if (challenge.challenger !== userId && challenge.challenged !== userId) {
      return res.status(403).json({ error: 'You are not a participant in this challenge' });
    }

    // Verify status is disputed
    if (challenge.status !== 'disputed') {
      return res.status(400).json({ error: 'Challenge is not in disputed status' });
    }

    console.log(`✅ Refund declined. Challenge continues to resolution.`);

    // Keep challenge in disputed status - awaiting admin resolution or evidence submission
    // No update needed - just notify the requester

    const requester = await db.select().from(users).where(eq(users.id, userId === challenge.challenger ? challenge.challenged : challenge.challenger)).limit(1);
    const requesterName = requester[0]?.firstName || 'Someone';

    await notificationService.sendNotification({
      userId: userId === challenge.challenger ? challenge.challenged! : challenge.challenger!,
      event: NotificationEvent.NEW_CHALLENGE_ACCEPTED,
      title: '❌ Refund Declined',
      message: `${requesterName} declined the refund request. The dispute will proceed to resolution.`,
      metadata: {
        challengeId: challengeId,
        challengeTitle: challenge.title,
      },
      channels: [NotificationChannel.PUSHER, NotificationChannel.FIREBASE],
      priority: NotificationPriority.MEDIUM,
    }).catch(err => {
      console.warn('⚠️ Failed to notify of declined refund:', err.message);
    });

    res.json({
      success: true,
      challengeId,
      message: 'Refund declined. Challenge continues to dispute resolution.',
    });

  } catch (error: any) {
    console.error('❌ Failed to decline refund:', error);
    res.status(500).json({
      error: 'Failed to decline refund',
      message: error.message,
    });
  }
});

/**
 * POST /api/admin/challenges/:id/force-refund
 * Admin endpoint to force refund both parties if dispute is unresolvable
 * Requires admin authentication
 */
router.post('/admin/:id/force-refund', PrivyAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const challengeId = parseInt(req.params.id);
    const userId = req.user?.id;
    const { reason } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // TODO: Add admin role verification
    // For now, comment indicates where admin check should go
    console.log(`\n⚖️ Admin ${userId} force-resolving challenge ${challengeId}...`);

    // Get challenge
    const dbChallenge = await db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1);

    if (!dbChallenge.length) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = dbChallenge[0];

    // Verify challenge is in disputed status
    if (challenge.status !== 'disputed') {
      return res.status(400).json({ error: 'Challenge must be in disputed status for admin force resolution' });
    }

    console.log(`✅ Force-refunding both participants...`);

    // Update challenge status
    await db
      .update(challenges)
      .set({
        status: 'cancelled',
        completedAt: new Date(),
        disputeReason: `Admin force resolution: ${reason || 'Unresolvable dispute'}`,
      })
      .where(eq(challenges.id, challengeId));

    // Release both escrow records
    await db
      .update(challengeEscrowRecords)
      .set({
        status: 'released',
        releasedAt: new Date(),
      })
      .where(eq(challengeEscrowRecords.challengeId, challengeId));

    console.log(`✅ Challenge force-resolved. Both escrows released.`);

    // Notify both parties
    const creator = await db.select().from(users).where(eq(users.id, challenge.challenger!)).limit(1);
    const acceptor = await db.select().from(users).where(eq(users.id, challenge.challenged!)).limit(1);

    const notificationMessage = `An administrator resolved the dispute. Your full stake has been returned. Reason: ${reason || 'Unresolvable dispute'}`;

    // Notify creator
    await notificationService.sendNotification({
      userId: challenge.challenger!,
      event: NotificationEvent.NEW_CHALLENGE_ACCEPTED,
      title: '⚖️ Admin Resolution',
      message: notificationMessage,
      metadata: {
        challengeId: challengeId,
        challengeTitle: challenge.title,
      },
      channels: [NotificationChannel.PUSHER, NotificationChannel.FIREBASE],
      priority: NotificationPriority.HIGH,
    }).catch(err => {
      console.warn('⚠️ Failed to notify creator:', err.message);
    });

    // Notify acceptor
    await notificationService.sendNotification({
      userId: challenge.challenged!,
      event: NotificationEvent.NEW_CHALLENGE_ACCEPTED,
      title: '⚖️ Admin Resolution',
      message: notificationMessage,
      metadata: {
        challengeId: challengeId,
        challengeTitle: challenge.title,
      },
      channels: [NotificationChannel.PUSHER, NotificationChannel.FIREBASE],
      priority: NotificationPriority.HIGH,
    }).catch(err => {
      console.warn('⚠️ Failed to notify acceptor:', err.message);
    });

    res.json({
      success: true,
      challengeId,
      status: 'admin_resolved',
      message: 'Challenge force-resolved. Both participants have been refunded.',
    });

  } catch (error: any) {
    console.error('❌ Failed to force resolve challenge:', error);
    res.status(500).json({
      error: 'Failed to force resolve challenge',
      message: error.message,
    });
  }
});

export default router;
