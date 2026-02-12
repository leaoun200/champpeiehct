// Route registration for Phase 4 API endpoints
// Import all blockchain-related routes and mount them on the Express app

import express from 'express';
import apiChallengesRouter from './api-challenges';
import apiPayoutsRouter from './api-payouts';
import apiPointsRouter from './api-points';
import apiAdminResolveRouter from './api-admin-resolve';
import apiAdminAuthRouter from './api-admin-auth';
import apiAdminDashboardRouter from './api-admin-dashboard';
import apiUserRouter from './api-user';
import apiFriendsRouter from './api-friends';
import apiFollowersRouter from './api-followers';
import notificationsRouter from './notificationsApi';
import apiTelegramRouter from './api-telegram';

export function registerBlockchainRoutes(app: express.Application) {
  /**
   * Admin Authentication & Dashboard
   * POST /api/admin/login - Admin login
   * GET /api/admin/stats - Dashboard stats
   * GET /api/admin/users - All users
   * GET /api/admin/challenges - All challenges
   */
  app.use('/api/admin', apiAdminAuthRouter);
  app.use('/api/admin', apiAdminDashboardRouter);

  /**
   * Challenge Operations
   * POST /api/challenges/create-admin - Create betting pool
   * POST /api/challenges/create-p2p - Create user-to-user challenge
   * POST /api/challenges/:id/join - Join admin challenge
   * POST /api/challenges/:id/accept - Accept P2P challenge
   * GET /api/challenges/:id - Get challenge details
   * GET /api/challenges - List challenges
   * GET /api/challenges/user/:userId - Get user's challenges
   */
  console.log('📋 Mounting /api/challenges router');
  app.use('/api/challenges', apiChallengesRouter);
  console.log('✅ /api/challenges router mounted');

  /**
   * Payout Operations
   * POST /api/payouts/:challengeId/claim - Claim payout
   * GET /api/payouts/:challengeId/status - Get payout status
   * GET /api/payouts/user/:userId - Get user's payouts
   * POST /api/payouts/batch-claim - Batch claim multiple payouts
   */
  app.use('/api/payouts', apiPayoutsRouter);

  /**
   * Points & Leaderboard Operations
   * GET /api/points/balance/:userId - Get points balance
   * POST /api/points/transfer - Transfer points
   * GET /api/points/leaderboard - Global leaderboard
   * GET /api/points/leaderboard/:userId - User rank & stats
   * GET /api/points/history/:userId - Transaction history
   * GET /api/points/statistics - Global statistics
   * POST /api/points/connect-wallet - Connect blockchain wallet
   * GET /api/points/wallets - Get user's wallets
   * POST /api/points/set-primary-wallet/:walletId - Set primary wallet
   */
  app.use('/api/points', apiPointsRouter);

  /**
   * Admin Resolution Operations
   * POST /api/admin/challenges/resolve - Resolve single challenge
   * POST /api/admin/challenges/batch-resolve - Batch resolve
   * GET /api/admin/challenges/pending - Get pending challenges
   * GET /api/admin/challenges/by-status/:status - Filter by status
   * GET /api/admin/blockchain/signing-stats - Get signing status
   * POST /api/admin/challenges/verify-resolution - Verify signature
   * GET /api/admin/challenges/:id/resolution-history - Get history
   */
  app.use('/api/admin/challenges', apiAdminResolveRouter);

  /**
   * User Account Operations
   * POST /api/user/fcm-token - Save FCM token for push notifications
   * GET /api/user/profile - Get current user profile
   * GET /api/user/transactions - Get user's transaction history
   */
  app.use('/api/user', apiUserRouter);

  /**
   * Friends Management
   * POST /api/friends/request - Send friend request
   * POST /api/friends/accept/:requestId - Accept friend request
   * POST /api/friends/reject/:requestId - Reject friend request
   * GET /api/friends - Get all friends
   * GET /api/friends/requests - Get pending friend requests
   * DELETE /api/friends/:friendId - Remove friend
   * GET /api/friends/status/:userId - Check friendship status
   */
  app.use('/api/friends', apiFriendsRouter);

  /**
   * Followers Management
   * POST /api/followers/:userId/follow - Follow/unfollow a user
   * GET /api/followers/:userId - Get user's followers list
   * GET /api/followers/:userId/following - Get user's following list
   * GET /api/followers/status/:userId - Check if following status
   */
  app.use('/api/followers', apiFollowersRouter);

  /**
   * Notifications Management
   * GET /api/notifications - Get user's notifications
   * PATCH /api/notifications/:id/read - Mark notification as read
   * DELETE /api/notifications/:id - Delete notification
   * GET /api/notifications/unread-count - Get unread count
   * PUT /api/notifications/preferences - Update notification preferences
   */
  app.use('/api/notifications', notificationsRouter);
  // Telegram helper endpoints (status, test broadcast)
  app.use('/api/telegram', apiTelegramRouter);

  console.log('✅ Blockchain REST API routes registered:');
  console.log('   - /api/challenges');
  console.log('   - /api/payouts');
  console.log('   - /api/points');
  console.log('   - /api/admin/challenges');
  console.log('   - /api/followers');
  console.log('   - /api/debug (client log receiver)');

  // Simple endpoint to receive client-side logs (for debugging in dev)
  app.post('/api/debug/client-logs', express.json(), (req, res) => {
    try {
      const { level = 'info', message = '', meta = null } = req.body || {};
      const prefix = `[CLIENT_LOG:${level.toUpperCase()}]`;
      if (meta) {
        console.log(prefix, message, JSON.stringify(meta, null, 2));
      } else {
        console.log(prefix, message);
      }
      res.json({ ok: true });
    } catch (e) {
      console.error('Failed to record client log:', e);
      res.status(500).json({ ok: false });
    }
  });
}

export { apiChallengesRouter, apiPayoutsRouter, apiPointsRouter, apiAdminResolveRouter };
