# VoiceOverBot

VoiceOverBot is a Telegram bot that transcribes voice messages sent to it using Google's Generative AI (Gemini). It's built with Node.js, TypeScript, and the `node-telegram-bot-api` library.

**Author:** Gemini (via Google)

## Features

*   Receives voice messages in Telegram chats.
*   Downloads the voice message.
*   Transcribes the audio using Google's Gemini Pro model (specifically `gemini-2.5-pro-preview-05-06` by default) via the Vercel AI SDK.
*   Replies to the original voice message with the transcribed text.
*   Handles chat member updates: greets when added to a new chat and informs about the need for admin rights to read messages.
*   Includes basic error handling and retry mechanisms.

## Project Structure

```
/
├── dist/                     # Compiled JavaScript files
├── src/
│   └── index.ts              # Main application logic
├── .env                      # Environment variables (create this file)
├── .gitignore                # Git ignore file
├── package.json              # Project dependencies and scripts
├── README.md                 # This file
└── tsconfig.json             # TypeScript compiler options
```

## Prerequisites

*   Node.js (v18 or higher recommended)
*   pnpm (or npm/yarn)
*   A Telegram Bot Token
*   A Google Generative AI API Key

## Setup

1.  **Clone the repository (or set up your existing project):**
    ```bash
    # If you have a git repo already, skip this
    git clone https://github.com/hormold/voiceoverbot.git
    cd voiceoverbot
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

3.  **Create a `.env` file** in the root of the project and add your API keys and bot token:
    ```env
    BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
    GOOGLE_GENERATIVE_AI_API_KEY=YOUR_GOOGLE_GENERATIVE_AI_API_KEY

    # Optional: Specify a Gemini model ID (defaults to gemini-2.5-pro-preview-05-06 in the code)
    # GEMINI_MODEL_ID=gemini-2.5-pro-preview-05-06
    ```
    *   Replace `YOUR_TELEGRAM_BOT_TOKEN` with your actual Telegram bot token.
    *   Replace `YOUR_GOOGLE_GENERATIVE_AI_API_KEY` with your Google AI API key.

4.  **Build the project (compile TypeScript to JavaScript):**
    ```bash
    pnpm build
    ```

## Running the Bot

*   **To start the bot for development (with auto-reloading via nodemon):**
    ```bash
    pnpm dev
    ```
    This command uses `nodemon` to watch for changes in `src/index.ts` and automatically restarts the bot.

*   **To start the bot for production:**
    ```bash
    pnpm start
    ```
    This command runs the compiled JavaScript from the `dist` directory.

## How it Works

1.  The bot connects to Telegram using the `node-telegram-bot-api`.
2.  When a voice message is received, the bot downloads the audio file into a buffer.
3.  The audio data is structured as a `CoreMessage` part with `type: "file"`, `mimeType: "audio/ogg"`, and the audio `Buffer`. This, along with a text prompt, is sent to the specified Google Gemini model using the `generateText` function from the Vercel AI SDK (`ai` package) with the `@ai-sdk/google` provider.
4.  A system prompt instructs the AI on how to behave: transcribe accurately, preserve the original language, apply proper formatting, avoid extraneous content, and strictly use the `outputTranscription` tool for its response.
5.  The AI is forced (via `toolChoice`) to use the `outputTranscription` tool. This tool is defined with a Zod schema ensuring the AI provides the transcribed text in the expected string format.
6.  When the AI calls the tool, the `execute` function within the tool definition resolves with the transcribed text.
7.  The bot then sends this text back to the Telegram chat as a reply to the original voice message.
8.  The bot also handles being added to new chats by sending a welcome message and mentioning the need for admin permissions to function correctly.

## Dependencies

*   `node-telegram-bot-api`: For interacting with the Telegram Bot API.
*   `ai`: Vercel AI SDK for streamlined access to AI models.
*   `@ai-sdk/google`: Google provider for the Vercel AI SDK.
*   `dotenv`: For loading environment variables from a `.env` file.
*   `zod`: For schema validation (used for defining the AI tool's parameters).

## Development Dependencies

*   `typescript`: For TypeScript language support.
*   `ts-node`: To run TypeScript files directly.
*   `nodemon`: To automatically restart the application during development.
*   `@types/*`: Type definitions for various libraries.

## Contributing

Contributions are welcome! If you have suggestions or improvements, feel free to open an issue or submit a pull request.

---

*This project was generated with assistance from Gemini.* 