/** Silent Vault-to-Telegram backup. Fire-and-forget from saver. */
import { logger } from '../core/logger.js';

export async function backupToTelegram(
  filename: string,
  markdown: string,
  meta: { title: string; category: string; url: string },
): Promise<void> {
  const token = process.env.BOT_TOKEN;
  const channelId = process.env.BACKUP_CHANNEL_ID;
  if (!token || !channelId) return;

  const caption = `📥 ${meta.category}\n${meta.title}\n${meta.url}`.slice(0, 1024);
  const form = new FormData();
  form.append('chat_id', channelId);
  form.append('caption', caption);
  form.append('document', new Blob([markdown], { type: 'text/plain' }), filename);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    logger.warn('telegram-backup', 'sendDocument 失敗', { status: res.status });
  }
}
