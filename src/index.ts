import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import type { CoreMessage } from 'ai';
import { generateText, UserContent } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

dotenv.config();

const botToken = process.env.BOT_TOKEN;
const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const geminiModelId =
  process.env.GEMINI_MODEL_ID || 'gemini-2.5-pro-preview-05-06';

if (!botToken) {
  console.error('BOT_TOKEN is missing from .env');
  process.exit(1);
}
if (!googleApiKey) {
  console.error(
    'GOOGLE_GENERATIVE_AI_API_KEY is missing from .env for Google AI',
  );
  process.exit(1);
}

const bot = new TelegramBot(botToken, { polling: true });
let botId: number;

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function retry<T>(
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

async function downloadVoiceToBuffer(fileId: string): Promise<Buffer> {
  const fileStream = bot.getFileStream(fileId);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    fileStream.on('data', (chunk) => chunks.push(chunk as Buffer));
    fileStream.on('error', reject);
    fileStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const transcriptionSystemPrompt = `You are a highly proficient audio transcription robot. Your primary function is to accurately convert spoken audio from telegram voice messages into written text with correct punctuation, formatting and language preservation.

## Key Instructions
0.  Do not add anything not related to the transcription / tldr to output, keep it as correct as possible.
1.  **Language Preservation**: Transcribe the audio in the exact language spoken. Do not translate.
2.  **Accuracy**: Capture all spoken words precisely.
3.  **Punctuation and Formatting**: Apply standard punctuation (periods, commas, question marks, capitalization, paragraphs for distinct speakers or long pauses if discernible) to ensure the text is clear, well-structured, and easy to read.
4.  **No Extraneous Content**: Your output must *only* be the transcribed text. Do not include any introductory phrases (e.g., "Here is the transcription:"), summaries, disclaimers, or any other text that is not part of the direct transcription.
5.  **Tool Usage**: You MUST use the 'outputTranscription' tool to provide the final transcribed text.
6.  **Filler Words**: Remove all filler words like "um", "uh", "ah", "er", "like" and same on another languages. If the text is really short, just return the text as is.
7.  **Points**: If voice message contains some lists, points, etc. Make proper formatting for them.
  Example:
  "do this, do that, do the other thing"
  should be formatted as:
  "1. Do this
  2. Do that
  3. Do the other thing"
8.  **Numbers**: If voice message contains numbers, make proper formatting for them.
  Example:
  "seven thousand, eight hundred, nine" -> "7000, 800, 9"

## TLDR
If text is longer than 300 characters, provide a tldr summary of the transcription. The summary MUST:
1. Use the same language as the transcription
2. Maintain the same first/third person perspective as the original message
3. Keep the same tone, style and speaking voice
4. Be 20-30 words summarizing the general idea 
5. Be a single sentence, not a list of points
6. NOT describe the message in third person (like "the user talks about...") - instead, preserve the original voice`;

async function transcribeAudio(
  audioBuffer: Buffer,
): Promise<{ transcribedText: string; tldr: string | null }> {
  log('Starting audio transcription with Gemini...');

  return new Promise<{ transcribedText: string; tldr: string | null }>(
    async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Transcription timed out after 60 seconds'));
      }, 60000);

      try {
        const userMessageContent: CoreMessage = {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Transcribe the audio and provide the result using the outputTranscription tool.',
            },
            {
              type: 'file',
              mimeType: 'audio/ogg',
              data: audioBuffer,
            },
          ],
        };

        await generateText({
          model: google(geminiModelId),
          system: transcriptionSystemPrompt,
          messages: [userMessageContent],
          toolChoice: { type: 'tool', toolName: 'outputTranscription' },
          tools: {
            outputTranscription: {
              description:
                "Outputs the final transcribed text from the audio, ensuring it's well-formatted and in the original language.",
              parameters: z.object({
                transcribedText: z
                  .string()
                  .describe(
                    'The complete and accurately transcribed text from the audio, in the original language, with proper punctuation.',
                  ),
                tldr: z
                  .string()
                  .nullable()
                  .describe(
                    'A short summary of the transcription, in the original language, with proper punctuation (Optional).',
                  ),
              }),
              execute: async ({
                transcribedText,
                tldr,
              }: {
                transcribedText: string;
                tldr: string | null;
              }) => {
                log('Transcription tool executed by AI.');
                clearTimeout(timeoutId);
                resolve({ transcribedText, tldr });
                return 'Transcription successfully processed and extracted.';
              },
            },
          },
        });
      } catch (error) {
        log(`Error during transcription: ${(error as Error).message}`);
        clearTimeout(timeoutId);
        reject(error);
      }
    },
  );
}

bot
  .getMe()
  .then((me) => {
    if (me && me.id) {
      botId = me.id;
      log(
        `Bot initialized: ${me.username} (ID: ${botId}). Model: ${geminiModelId}`,
      );
    } else {
      log('Failed to get bot info: User object or ID is undefined. Exiting.');
      process.exit(1);
    }
  })
  .catch((err) => {
    log(`Failed to get bot info: ${(err as Error).message}. Exiting.`);
    process.exit(1);
  });

bot.on('chat_member', async (ctx) => {
  if (ctx.new_chat_member && ctx.new_chat_member.user.id === botId) {
    log(
      `Bot added to chat: ${ctx.chat.title || 'Untitled Chat'} (ID: ${ctx.chat.id}) by ${ctx.from.username || ctx.from.id}`,
    );
    try {
      await bot.sendMessage(
        ctx.chat.id,
        'Привет! Чтобы я мог работать, пожалуйста, дайте мне права администратора для чтения сообщений.',
      );
    } catch (error) {
      log(
        `Failed to send welcome message to chat ${ctx.chat.id}: ${
          (error as Error).message
        }`,
      );
    }
  }
});

bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  if (!msg.voice || !msg.voice.file_id) {
    log(`Received message in chat ${chatId} without voice data or file_id.`);
    return;
  }
  const voiceFileId = msg.voice.file_id;
  const messageId = msg.message_id;
  const userId = msg.from?.id;
  const username = msg.from?.username || msg.from?.first_name || 'UnknownUser';

  log(
    `Received voice message from ${username} (ID: ${userId}) in chat ${chatId}`,
  );

  try {
    await bot.sendChatAction(chatId, 'typing');
    log('Downloading voice file...');
    const audioBuffer = await retry(() => downloadVoiceToBuffer(voiceFileId));
    log(`Voice file downloaded (${(audioBuffer.length / 1024).toFixed(2)} KB)`);

    await bot.sendChatAction(chatId, 'typing');
    log('Transcribing audio...');
    const { transcribedText, tldr } = await retry(() =>
      transcribeAudio(audioBuffer),
    );
    log('Transcription received: ' + tldr);
    let template: string =
      tldr?.trim() && tldr.length > 0
        ? `<b>TLDR:</b>\n${tldr}\n<b>Original text:</b>\n${transcribedText}`
        : transcribedText;

    await bot.sendMessage(chatId, template, {
      reply_to_message_id: messageId,
      parse_mode: 'HTML',
    });
    log(`Replied to ${username} in chat ${chatId}`);
  } catch (error) {
    const errorMessage =
      (error as Error).message || 'Unknown error during processing';
    log(
      `Error processing voice message from ${username} in chat ${chatId}: ${errorMessage}`,
    );
    try {
      await bot.sendMessage(
        chatId,
        "Sorry, I couldn't process your voice message. Please try again.",
        { reply_to_message_id: messageId },
      );
    } catch (replyError) {
      log(
        `Failed to send error reply to ${username}: ${
          (replyError as Error).message
        }`,
      );
    }
  }
});

// Define a type for Telegram errors if available, or use 'any'
interface TelegramError extends Error {
  code?: string | number; // Or the specific type for error codes
}

bot.on('polling_error', (error: TelegramError) => {
  log(`Polling error: ${error.code || 'N/A'} - ${error.message || error}`);
});

bot.on('webhook_error', (error: TelegramError) => {
  log(`Webhook error: ${error.code || 'N/A'} - ${error.message || error}`);
});

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

log('Bot is starting...');
