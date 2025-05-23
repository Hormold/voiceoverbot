import type TelegramBot from 'node-telegram-bot-api';
import ffmpeg from 'fluent-ffmpeg';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

export async function downloadVoiceToBuffer(
  bot: TelegramBot,
  fileId: string,
): Promise<Buffer> {
  const fileStream = bot.getFileStream(fileId);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    fileStream.on('data', (chunk) => chunks.push(chunk as Buffer));
    fileStream.on('error', reject);
    fileStream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Extracts audio from a video note (video circle) and returns it as an audio buffer.
 * Video notes are MP4 files, we extract the audio track for transcription.
 */

export async function extractAudioFromVideoNote(
  bot: TelegramBot,
  fileId: string,
): Promise<Buffer> {
  log('Downloading video note for audio extraction...');

  // First download the video file
  const videoBuffer = await downloadVoiceToBuffer(bot, fileId);

  log(
    `Video note downloaded (${(videoBuffer.length / 1024).toFixed(2)} KB), extracting audio...`,
  );

  // Create temporary file for the video (MP4 format needs seekable input)
  const tempVideoPath = join(
    tmpdir(),
    `video_note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`,
  );

  try {
    // Write video buffer to temporary file
    writeFileSync(tempVideoPath, videoBuffer);

    return new Promise((resolve, reject) => {
      const audioChunks: Buffer[] = [];
      let stderrOutput = '';

      // More robust FFmpeg command for video notes using file input
      const command = ffmpeg(tempVideoPath)
        .noVideo() // Remove video stream
        .audioChannels(1) // Mono audio
        .audioFrequency(16000) // 16kHz sample rate (good for speech)
        .audioBitrate('64k') // Lower bitrate for speech
        .audioCodec('libmp3lame') // Convert to MP3 for compatibility
        .format('mp3')
        .outputOptions([
          '-map',
          '0:a?', // Map audio stream if it exists, don't fail if no audio
          '-ac',
          '1', // Force mono
          '-ar',
          '16000', // Force 16kHz sample rate
          '-avoid_negative_ts',
          'make_zero', // Handle timing issues
        ])
        .on('start', () => {
          log('Extracting audio from video note...');
        })
        .on('stderr', (stderrLine: string) => {
          stderrOutput += stderrLine + '\n';
          // Only log important errors, not all stderr output
          if (
            stderrLine.includes('Error') ||
            stderrLine.includes('failed') ||
            stderrLine.includes('Invalid')
          ) {
            log(`FFmpeg stderr: ${stderrLine}`);
          }
        })
        .on('error', (err: Error) => {
          log(`FFmpeg error during audio extraction: ${err.message}`);

          // Clean up temp file silently
          try {
            unlinkSync(tempVideoPath);
          } catch (cleanupErr) {
            log(
              `Failed to cleanup temp file: ${(cleanupErr as Error).message}`,
            );
          }

          // If no audio stream exists, reject with a specific error
          if (
            err.message.includes('does not contain any stream') ||
            err.message.includes('No audio') ||
            stderrOutput.includes('does not contain any stream')
          ) {
            reject(new Error('Video note does not contain audio stream'));
          } else {
            reject(
              new Error(
                `Failed to extract audio from video note: ${err.message}`,
              ),
            );
          }
        })
        .on('end', () => {
          const audioBuffer = Buffer.concat(audioChunks);
          log(
            `Audio extraction completed (${(audioBuffer.length / 1024).toFixed(2)} KB)`,
          );

          // Clean up temp file silently
          try {
            unlinkSync(tempVideoPath);
          } catch (cleanupErr) {
            log(
              `Failed to cleanup temp file: ${(cleanupErr as Error).message}`,
            );
          }

          // Check if we actually got audio data
          if (audioBuffer.length < 1000) {
            // Less than 1KB is suspicious
            log(
              `Warning: Extracted audio file is very small (${audioBuffer.length} bytes) - video note may not contain audio or may be silent`,
            );
            reject(
              new Error(
                'Extracted audio file is too small - video note may not contain audio or may be silent',
              ),
            );
            return;
          }

          resolve(audioBuffer);
        });

      // Capture the output stream
      const ffmpegStream = command.pipe();

      ffmpegStream.on('data', (chunk: Buffer) => {
        audioChunks.push(chunk);
      });

      ffmpegStream.on('error', (err: Error) => {
        log(`FFmpeg stream error: ${err.message}`);

        // Clean up temp file silently
        try {
          unlinkSync(tempVideoPath);
        } catch (cleanupErr) {
          log(`Failed to cleanup temp file: ${(cleanupErr as Error).message}`);
        }

        reject(err);
      });
    });
  } catch (error) {
    // Clean up temp file if creation failed
    try {
      unlinkSync(tempVideoPath);
    } catch (cleanupErr) {
      // Ignore cleanup errors if file creation failed
    }

    throw new Error(
      `Failed to create temporary file for video processing: ${(error as Error).message}`,
    );
  }
}

export function sendContinuousTypingAction(
  bot: TelegramBot,
  chatId: number | string,
) {
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
