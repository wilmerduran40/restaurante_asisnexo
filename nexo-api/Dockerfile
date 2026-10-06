FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public
COPY db ./db

RUN mkdir -p /app/data /app/uploads

EXPOSE 3000
CMD ["node", "src/server.js"]