import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { CoreMessage, generateText, UserContent } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

dotenv.config();

const botToken = process.env.BOT_TOKEN;
const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const geminiModelId = process.env.GEMINI_MODEL_ID || "gemini-2.5-pro-preview-05-06";

if (!botToken) {
  console.error("BOT_TOKEN is missing from .env");
  process.exit(1);
}
if (!googleApiKey) {
  console.error(
    "GOOGLE_GENERATIVE_AI_API_KEY is missing from .env for Google AI",
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
    fileStream.on("data", (chunk) => chunks.push(chunk as Buffer));
    fileStream.on("error", reject);
    fileStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const transcriptionSystemPrompt = `\
You are a highly proficient audio transcription service. Your primary function is to accurately convert spoken audio into written text.
Key Instructions:
1.  **Language Preservation**: Transcribe the audio in the exact language spoken. Do not translate.
2.  **Accuracy**: Capture all spoken words precisely.
3.  **Punctuation and Formatting**: Apply standard punctuation (periods, commas, question marks, capitalization, paragraphs for distinct speakers or long pauses if discernible) to ensure the text is clear, well-structured, and easy to read.
4.  **No Extraneous Content**: Your output must *only* be the transcribed text. Do not include any introductory phrases (e.g., "Here is the transcription:"), summaries, disclaimers, or any other text that is not part of the direct transcription.
5.  **Tool Usage**: You MUST use the 'outputTranscription' tool to provide the final transcribed text.`;

async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  log("Starting audio transcription with Gemini...");

  return new Promise<string>(async (resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Transcription timed out after 60 seconds"));
    }, 60000);

    try {
      // Constructing the user message. The Vercel AI SDK can be particular about content types.
      // The structure `{ type: "file", mimeType: "audio/ogg", data: audioBuffer }` is based on your example.
      // If this does not work, the `google` provider might expect Base64 encoded data for generic files,
      // or a specific format for audio input not using the `image` type.
      const userMessageContent: CoreMessage = {
        role: "user",
        content: [
          {
            type: "text",
            text: "Transcribe the audio and provide the result using the outputTranscription tool.",
          },
          {
            type: "file",
            mimeType: "audio/ogg",
            data: audioBuffer,
          },
        ],
      };

      const { toolResults, finishReason } = await generateText({
        model: google(geminiModelId),
        system: transcriptionSystemPrompt,
        messages: [userMessageContent],
        toolChoice: { type: "tool", toolName: "outputTranscription" },
        tools: {
          outputTranscription: {
            description:
              "Outputs the final transcribed text from the audio, ensuring it's well-formatted and in the original language.",
            parameters: z.object({
              transcribedText: z
                .string()
                .describe(
                  "The complete and accurately transcribed text from the audio, in the original language, with proper punctuation.",
                ),
            }),
            execute: async ({ transcribedText }: { transcribedText: string }) => {
              log("Transcription tool executed by AI.");
              clearTimeout(timeoutId);
              resolve(transcribedText);
              return "Transcription successfully processed and extracted.";
            },
          },
        },
      });
    } catch (error) {
      log(`Error during transcription: ${(error as Error).message}`);
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

bot.getMe().then((me) => {
  if (me && me.id) {
    botId = me.id;
    log(
      `Bot initialized: ${me.username} (ID: ${botId}). Model: ${geminiModelId}`,
    );
  } else {
    log("Failed to get bot info: User object or ID is undefined. Exiting.");
    process.exit(1);
  }
}).catch((err) => {
  log(`Failed to get bot info: ${(err as Error).message}. Exiting.`);
  process.exit(1);
});

bot.on("chat_member", async (ctx) => {
  if (ctx.new_chat_member && ctx.new_chat_member.user.id === botId) {
    log(
      `Bot added to chat: ${ctx.chat.title || 'Untitled Chat'} (ID: ${ctx.chat.id}) by ${ctx.from.username || ctx.from.id}`,
    );
    try {
      await bot.sendMessage(
        ctx.chat.id,
        "Привет! Чтобы я мог работать, пожалуйста, дайте мне права администратора для чтения сообщений.",
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

bot.on("voice", async (msg) => {
  const chatId = msg.chat.id;
  if (!msg.voice || !msg.voice.file_id) {
    log(`Received message in chat ${chatId} without voice data or file_id.`);
    return;
  }
  const voiceFileId = msg.voice.file_id;
  const messageId = msg.message_id;
  const userId = msg.from?.id;
  const username = msg.from?.username || msg.from?.first_name || "UnknownUser";

  log(`Received voice message from ${username} (ID: ${userId}) in chat ${chatId}`);

  try {
    await bot.sendChatAction(chatId, "typing");
    log("Downloading voice file...");
    const audioBuffer = await retry(() => downloadVoiceToBuffer(voiceFileId));
    log(`Voice file downloaded (${(audioBuffer.length / 1024).toFixed(2)} KB)`);

    await bot.sendChatAction(chatId, "typing");
    log("Transcribing audio...");
    const transcribedText = await retry(() => transcribeAudio(audioBuffer));
    log("Transcription received: " + transcribedText.substring(0, 100) + (transcribedText.length > 100 ? "..." : ""));

    await bot.sendMessage(chatId, transcribedText, {
      reply_to_message_id: messageId,
    });
    log(`Replied to ${username} in chat ${chatId}`);
  } catch (error) {
    const errorMessage = (error as Error).message || "Unknown error during processing";
    log(
      `Error processing voice message from ${username} in chat ${chatId}: ${errorMessage}`,
    );
    try {
      await bot.sendMessage(
        chatId,
        "Извините, не удалось обработать ваше голосовое сообщение. Попробуйте еще раз.",
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

bot.on("polling_error", (error: TelegramError) => {
  log(
    `Polling error: ${error.code || 'N/A'} - ${error.message || error}`,
  );
});

bot.on("webhook_error", (error: TelegramError) => {
  log(
    `Webhook error: ${error.code || 'N/A'} - ${error.message || error}`,
  );
});

process.on("SIGTERM", async () => {
  log("SIGTERM signal received. Shutting down gracefully...");
  try {
    if (bot.isPolling()) {
        await bot.stopPolling({ cancel: true });
        log("Bot polling stopped.");
    }
    process.exit(0);
  } catch (e) {
    log(`Error during SIGTERM shutdown: ${(e as Error).message}`);
    process.exit(1);
  }
});

process.on("SIGINT", async () => {
  log("SIGINT signal received. Shutting down gracefully...");
  try {
    if (bot.isPolling()) {
        await bot.stopPolling({ cancel: true });
        log("Bot polling stopped.");
    }
    process.exit(0);
  } catch (e) {
    log(`Error during SIGINT shutdown: ${(e as Error).message}`);
    process.exit(1);
  }
});

log("Bot is starting...");
