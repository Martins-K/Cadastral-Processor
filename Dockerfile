# Use the official Node.js image
FROM node:22.12.0

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install system dependencies required by Playwright
RUN apt-get update && \
    apt-get install -y \
    libgtk-4-1 \
    libgraphene-1.0-0 \
    libgstgl-1.0-0 \
    libgstcodecparsers-1.0-0 \
    libavif15 \
    libenchant-2-2 \
    libsecret-1-0 \
    libmanette-0.2-0 \
    libgles2 \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js dependencies
RUN npm install

# Install Playwright browsers
RUN npx playwright install

# Copy the rest of the application code
COPY . .

# Expose the port your app runs on
EXPOSE 10000

# Start the application
CMD ["node", "server.js"]