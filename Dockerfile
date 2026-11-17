# ---------------------------------------------------------------
# Container image of the Task Management System.
# Used by docker-compose to run the whole app locally.
# ---------------------------------------------------------------
FROM node:20-alpine

WORKDIR /app

# Install only production dependencies first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the application code.
COPY src ./src
COPY public ./public
COPY sql ./sql

# Do not run as root inside the container.
RUN mkdir -p logs uploads && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "src/server.js"]
