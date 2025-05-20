import TelegramBot from 'node-telegram-bot-api';

// It's crucial to pass the bot instance to functions that need it,
// rather than relying on a global instance, for better testability and modularity.

export function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

export async function retry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000,
): Promise<T> {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      log(`Retry ${i + 1}/${retries} failed: ${(err as Error).message}`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw lastError;
}

export async function downloadVoiceToBuffer(bot: TelegramBot, fileId: string): Promise<Buffer> {
  const fileStream = bot.getFileStream(fileId);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    fileStream.on('data', (chunk) => chunks.push(chunk as Buffer));
    fileStream.on('error', reject);
    fileStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

export function sendContinuousTypingAction(bot: TelegramBot, chatId: number | string) {
  let intervalId: NodeJS.Timeout;
  return {
    start: () => {
      // Send initial typing action
      void bot.sendChatAction(chatId, 'typing');
      // Set up interval to send typing action every 6 seconds
      intervalId = setInterval(() => {
        void bot.sendChatAction(chatId, 'typing');
      }, 6000); // This 6000 should probably be a config value later
    },
    stop: () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    },
  };
} 