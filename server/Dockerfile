FROM node:16.13.0

WORKDIR /src

# Copy proto files from project root
COPY protos ./protos

# Copy server package files
COPY server/package.json ./

# Install dependencies
RUN npm install

# Copy server source files
COPY server/ .

# Build TypeScript (will copy protos to build/protos)
RUN npm run build

# Expose gRPC port
EXPOSE 50051

# Run server
CMD ["npm", "start"]