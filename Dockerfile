FROM node:lts-alpine

WORKDIR /app

# Package-Definitionen kopieren und Abhängigkeiten installieren
COPY package*.json ./
RUN npm install --omit=dev

# Anwendungscode kopieren
COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["npm", "start"]
