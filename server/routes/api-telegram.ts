import express, { Request, Response } from 'express';
import { telegramBot } from '../telegramBot';

const router = express.Router();

// GET /api/telegram/status
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const configured = telegramBot.isConfigured();
    res.json({ configured, channelId: process.env.TELEGRAM_CHANNEL_ID || null, groupId: process.env.TELEGRAM_GROUP_ID || null });
  } catch (error: any) {
    console.error('Failed to get telegram status:', error);
    res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
});

// POST /api/telegram/test-broadcast
// Triggers a test broadcast using the existing telegramBot service.
router.post('/test-broadcast', async (req: Request, res: Response) => {
  try {
    if (!telegramBot.isConfigured()) {
      return res.status(400).json({ ok: false, error: 'Telegram not configured' });
    }

    const sample = {
      id: Date.now(),
      title: 'Test broadcast from API',
      description: 'This is a one-off test message triggered via /api/telegram/test-broadcast',
      amount: 0,
      category: 'Test',
      creator: { username: 'system', firstName: 'System' },
      challengeType: 'admin',
      status: 'test',
      expirationHours: 1,
      isAdminChallenge: true,
    } as any;

    const ok = await telegramBot.broadcastChallenge(sample);
    res.json({ ok: !!ok });
  } catch (error: any) {
    console.error('Test broadcast failed:', error);
    res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
});

export default router;
