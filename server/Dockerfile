FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY shared ./shared
COPY server ./server
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "--prefix", "server", "start"]
