# Use Node.js 20 specifically
FROM node:20.17.0-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 4000

# Start the application
CMD ["npm", "start"]
