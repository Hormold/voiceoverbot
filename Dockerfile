# Use Node.js 20 Alpine as base image for smaller size
FROM node:20-alpine

# Install FFmpeg and other necessary packages
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install pnpm globally
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the TypeScript code
RUN pnpm build

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S voicebot -u 1001

# Change ownership of the app directory
RUN chown -R voicebot:nodejs /app
USER voicebot

# Start the application
CMD ["pnpm", "start"] 