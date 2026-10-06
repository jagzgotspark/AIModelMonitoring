FROM node:20-alpine

WORKDIR /app

# Install the exact versions from the lockfile so every machine gets the same dependencies.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]
