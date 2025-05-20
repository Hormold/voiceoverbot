import TelegramBot from 'node-telegram-bot-api';
import { botToken, geminiModelId } from './modules/config.js';
import { log } from './modules/utils.js';
import { initializeTelegramHandlers } from './modules/telegramHandlers.js';

const bot = new TelegramBot(botToken as string, { polling: true });

initializeTelegramHandlers(bot);
log(`Bot is starting... Model: ${geminiModelId}`);

process.on('SIGTERM', async () => {
  log('SIGTERM signal received. Shutting down gracefully...');
  try {
    if (bot.isPolling()) {
      await bot.stopPolling({ cancel: true });
      log('Bot polling stopped.');
    }
    process.exit(0);
  } catch (e) {
    log(`Error during SIGTERM shutdown: ${(e as Error).message}`);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  log('SIGINT signal received. Shutting down gracefully...');
  try {
    if (bot.isPolling()) {
      await bot.stopPolling({ cancel: true });
      log('Bot polling stopped.');
    }
    process.exit(0);
  } catch (e) {
    log(`Error during SIGINT shutdown: ${(e as Error).message}`);
    process.exit(1);
  }
});
