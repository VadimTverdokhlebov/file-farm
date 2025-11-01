FROM node:16.13.0

WORKDIR /src

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY . .

# Build TypeScript
RUN npm run build

# Expose gRPC port
EXPOSE 50051

# Run server
CMD ["npm", "start"]