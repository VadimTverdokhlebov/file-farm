import * as grpc from '@grpc/grpc-js';
import logger from './utils/logger';
import getServer from './app';
import { ENVIRONMENT, GRPC_PORT } from './utils/secrets';

(() => {
    const server = getServer();
    server.bindAsync(`0.0.0.0:${GRPC_PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
        if (err) {
            logger.error(err);
            process.exit(1);
        } else {
            server.start();
            logger.info(`Server running at http://127.0.0.1:${GRPC_PORT} in ${ENVIRONMENT} mode.`);
            logger.info(`Services: UserService, FileService`);
        }
    });
})();
