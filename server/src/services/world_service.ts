import logger from '../utils/logger';

export function Service_Call_World(req: any, res: any) {
    logger.info('HelloWorldService added to server');
    console.log(req.request);
    res(null, req.request);
}
