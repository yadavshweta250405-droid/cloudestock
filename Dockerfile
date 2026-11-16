FROM node:22-slim

# Create app directory
WORKDIR /app

# Ensure non-root node user has permissions
RUN mkdir -p /app/database/data/files && chown -R node:node /app

# Copy application files
COPY --chown=node:node . .

# Set environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Switch to non-root user
USER node

# Expose HTTP port
EXPOSE 3000

# Health check matching Section 5.4 in AWS_INTEGRATION_GUIDE.md
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start application server
CMD ["node", "backend/src/server.js"]

