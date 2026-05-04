FROM node:20-alpine

WORKDIR /app

# Install root dependencies
COPY package*.json ./
RUN npm install

# Install dashboard dependencies
COPY dashboard/package*.json ./dashboard/
RUN npm install --prefix dashboard

# Copy source and build dashboard
COPY . .
RUN cd dashboard && npm run build

EXPOSE 3001

CMD ["node", "index.js"]
