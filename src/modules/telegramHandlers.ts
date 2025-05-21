import type { Message } from 'node-telegram-bot-api';
import type TelegramBot from 'node-telegram-bot-api';
import {
  log,
  retry,
  downloadVoiceToBuffer,
  sendContinuousTypingAction,
} from './utils.js';
import { transcribeAudio } from './aiService.js';

// Define a type for Telegram errors if available, or use 'any'
interface TelegramError extends Error {
  code?: string | number; // Or the specific type for error codes
}

const supportedAudioMimeTypes = [
  'audio/mpeg', // .mp3
  'audio/mp4', // .m4a, .mp4 (though mp4 can be video, we're targeting audio)
  'audio/ogg', // .ogg
  'audio/wav', // .wav
  'audio/x-m4a', // .m4a (alternative MIME type)
  'audio/aac', // .aac
];

export function initializeTelegramHandlers(bot: TelegramBot) {
  let localBotId: number; // Stores botId once fetched

  bot
    .getMe()
    .then((me) => {
      if (me && me.id) {
        localBotId = me.id;
        log(
          `Telegram Handlers Initialized for Bot: ${me.username} (ID: ${localBotId})`,
        );
      } else {
        log(
          'Failed to get bot info for handlers: User object or ID is undefined. Some handlers might not work as expected.',
        );
        // process.exit(1); // Decide if this is critical enough to exit
      }
    })
    .catch((err) => {
      log(
        `Failed to get bot info for handlers: ${(err as Error).message}. Some handlers might not work as expected.`,
      );
      // process.exit(1); // Decide if this is critical enough to exit
    });

  bot.on('chat_member', async (ctx) => {
    // Ensure localBotId is set before using it
    if (
      localBotId &&
      ctx.new_chat_member &&
      ctx.new_chat_member.user.id === localBotId
    ) {
      log(
        `Bot added to chat: ${ctx.chat.title || 'Untitled Chat'} (ID: ${
          ctx.chat.id
        }) by ${ctx.from.username || ctx.from.id}`,
      );
      try {
        await bot.sendMessage(
          ctx.chat.id,
          'Hello! I am a bot that transcribes voice messages. Please give me admin rights to track all voice messages in the chat.',
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

  bot.on('voice', async (msg: Message) => {
    const chatId = msg.chat.id;
    if (!msg.voice || !msg.voice.file_id) {
      log(`Received message in chat ${chatId} without voice data or file_id.`);
      return;
    }
    const voiceFileId = msg.voice.file_id;
    const messageId = msg.message_id;
    const userId = msg.from?.id;
    const username =
      msg.from?.username || msg.from?.first_name || 'UnknownUser';

    log(
      `Received voice message from ${username} (ID: ${userId}) in chat ${chatId}`,
    );

    const typingAction = sendContinuousTypingAction(bot, chatId);

    try {
      typingAction.start();
      log('Downloading voice file...');
      const audioBuffer = await retry(() =>
        downloadVoiceToBuffer(bot, voiceFileId),
      );
      log(
        `Voice file downloaded (${(audioBuffer.length / 1024).toFixed(2)} KB)`,
      );

      log('Transcribing audio...');
      const { transcribedText, tldr } = await retry(() =>
        transcribeAudio(audioBuffer),
      );
      log('Transcription received: ' + tldr); // Consider logging less in production
      let template: string =
        tldr?.trim() && tldr.length > 0
          ? `<b>TLDR:</b>\n${tldr}\n<b>Original text:</b>\n${transcribedText}`
          : transcribedText;

      typingAction.stop();
      await bot.sendMessage(chatId, template, {
        reply_to_message_id: messageId,
        parse_mode: 'HTML',
      });
      log(`Replied to ${username} in chat ${chatId}`);
    } catch (error) {
      typingAction.stop();
      const errorMessage =
        (error as Error).message || 'Unknown error during processing';
      log(
        `Error processing voice message from ${username} in chat ${chatId}: ${errorMessage}`,
      );
      try {
        await bot.sendMessage(
          chatId,
          "Sorry, I couldn't process your voice message. Please try again.", // This should be configurable
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

  // Handler for audio files sent as documents
  bot.on('message', async (msg: Message) => {
    if (msg.document && msg.chat.id) {
      const chatId = msg.chat.id;
      const document = msg.document;

      if (
        document.mime_type &&
        supportedAudioMimeTypes.includes(document.mime_type)
      ) {
        log(
          `Received supported audio document: ${document.file_name || 'Unknown Filename'} (MIME: ${document.mime_type}) from chat ${chatId}`,
        );
        const typingIndicator = sendContinuousTypingAction(bot, chatId);
        typingIndicator.start();

        try {
          const fileId = document.file_id;
          const audioBuffer = await retry(() =>
            downloadVoiceToBuffer(bot, fileId),
          );
          log(
            `Audio document ${document.file_name || fileId} downloaded, size: ${audioBuffer.length} bytes. Transcribing...`,
          );

          // For document messages, msg.from might be undefined if sent by a channel.
          // We'll use chat.id for user context if msg.from is not available.
          // const userIdForLog = msg.from ? msg.from.id : `chat_${chatId}`; // aiService doesn't use this yet

          const { transcribedText, tldr } = await transcribeAudio(
            audioBuffer,
            document.mime_type,
          );

          let replyText = `<b>Transcription (Document: ${document.file_name || 'audio file'}):</b>\n${transcribedText}`;
          if (tldr) {
            replyText += `\n\n<b>TLDR:</b>\n${tldr}`;
          }

          await bot.sendMessage(chatId, replyText, {
            parse_mode: 'HTML',
            reply_to_message_id: msg.message_id,
          });
          log(
            `Transcription for document ${document.file_name || fileId} sent to chat ${chatId}.`,
          );
        } catch (error: any) {
          log(
            `Error processing audio document ${document.file_name || document.file_id} from chat ${chatId}: ${error.message}`,
          );
          await bot.sendMessage(
            chatId,
            "Sorry, I couldn't process this audio document. Please try another file or check if it's a valid audio format.",
            { reply_to_message_id: msg.message_id },
          );
        } finally {
          typingIndicator.stop();
        }
      } else if (document.mime_type) {
        // It's a document, but not a supported audio type
        log(
          `Received unsupported document type: ${document.mime_type} from chat ${chatId}. File: ${document.file_name || 'Unknown Filename'}`,
        );
        // Optionally, inform the user about unsupported file types if it's not an audio type we might expect
        // For now, we'll only explicitly reject if it *looks* like audio but isn't on our list,
        // or if they send something completely random as a document.
        // To avoid spamming, let's only reply if it's explicitly an 'audio/*' mime type that's not supported.
        if (document.mime_type.startsWith('audio/')) {
          await bot.sendMessage(
            chatId,
            `Sorry, the audio format ${document.mime_type} is not supported. Please try one of: MP3, M4A, OGG, WAV, AAC.`,
            { reply_to_message_id: msg.message_id },
          );
        }
      }
      // If it's a document but not audio, we simply ignore it silently
      // unless it's an audio/* mime type we don't support (handled above).
    }
    // This handler also processes other message types like 'text', etc.
    // If you want to *only* process documents here, you would use bot.on('document', ...)
    // But since 'voice' is handled separately, and we might want to add general text command processing
    // to this 'message' handler later, keeping it as 'message' is fine.
    // We just need to ensure we don't interfere with the specific 'voice' handler.
    // The 'voice' handler will trigger first for voice messages. For other messages, this one will trigger.
  });

  bot.on('polling_error', (error: TelegramError) => {
    log(`Polling error: ${error.code || 'N/A'} - ${error.message || error}`);
  });

  bot.on('webhook_error', (error: TelegramError) => {
    log(`Webhook error: ${error.code || 'N/A'} - ${error.message || error}`);
  });

  log('Telegram event handlers registered.');
}
