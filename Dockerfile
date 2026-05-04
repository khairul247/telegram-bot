FROM node:20-alpine

RUN apk add --no-cache bash

WORKDIR /app

# Install root dependencies
COPY package*.json ./
RUN npm install

# Install dashboard dependencies
COPY dashboard/package*.json ./dashboard/
RUN npm install --prefix dashboard

# Copy source and build dashboard
ARG CACHEBUST=1
COPY . .
RUN cd dashboard && npm run build

EXPOSE 3001

CMD ["node", "index.js"]
