import dotenv from 'dotenv';

dotenv.config();

export const botToken = process.env.BOT_TOKEN;
export const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
export const geminiModelId =
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