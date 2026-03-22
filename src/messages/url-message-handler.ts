import type { Telegraf } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { registerUrlProcessingHandler } from './url-processing-handler.js';
import { registerDocumentHandler } from './document-handler.js';
import { registerPhotoHandler } from './photo-handler.js';
import type { BotStats } from './types.js';

export type { BotStats };

export function registerMessageHandlers(bot: Telegraf, config: AppConfig, stats: BotStats): void {
  registerUrlProcessingHandler(bot, config, stats);
  registerDocumentHandler(bot, config, stats);
  registerPhotoHandler(bot, config, stats);
}
