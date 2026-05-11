/** Silent Vault-to-Telegram backup. Fire-and-forget from saver. */
import { logger } from '../core/logger.js';
import { rememberDislike, rememberDelete } from '../utils/dislike-action.js';

export async function backupToTelegram(
  filename: string,
  markdown: string,
  meta: { title: string; category: string; url: string; mdPath: string },
): Promise<void> {
  const token = process.env.BOT_TOKEN;
  const channelId = process.env.BACKUP_CHANNEL_ID;
  if (!token || !channelId) return;

  const caption = `📥 ${meta.category}\n${meta.title}\n${meta.url}`.slice(0, 1024);

  const dislikeToken = rememberDislike(meta.category);
  const deleteToken = rememberDelete(meta.category, meta.mdPath, meta.url);
  const replyMarkup = JSON.stringify({
    inline_keyboard: [[
      { text: `👎 不感興趣：${meta.category}`, callback_data: `dislike:${dislikeToken}` },
      { text: '🗑️ 刪除+封鎖', callback_data: `dislike:${deleteToken}` },
    ]],
  });

  const form = new FormData();
  form.append('chat_id', channelId);
  form.append('caption', caption);
  form.append('reply_markup', replyMarkup);
  form.append('document', new Blob([markdown], { type: 'text/plain' }), filename);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    logger.warn('telegram-backup', 'sendDocument 失敗', { status: res.status });
  }
}
