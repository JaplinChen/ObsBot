import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../core/logger.js';
import type { NotificationChannel } from './types.js';

const execFileAsync = promisify(execFile);

export async function sendGuardianNotification(
  channels: NotificationChannel[],
  title: string,
  message: string,
): Promise<void> {
  if (channels.includes('log')) {
    logger.info('guardian', `${title}: ${message}`);
  }
  if (channels.includes('macos')) {
    await sendMacOsNotification(title, message);
  }
}

async function sendMacOsNotification(title: string, message: string): Promise<void> {
  try {
    await execFileAsync('osascript', [
      '-e',
      `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`,
    ]);
  } catch (error) {
    logger.warn('guardian', 'macOS 通知失敗', error);
  }
}

function escapeAppleScript(input: string): string {
  return input.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
