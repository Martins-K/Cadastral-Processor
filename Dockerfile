FROM mcr.microsoft.com/playwright:v1.50.1-noble

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy project files
COPY . .

# Set environment variables
ENV PORT=10000
ENV NODE_ENV=production

# Expose the port
EXPOSE 10000

# Start the application
CMD ["node", "server.js"]