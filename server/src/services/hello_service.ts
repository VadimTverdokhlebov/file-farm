import logger from '../utils/logger';
import { RequestHello } from '../generated/filefarm/hello/RequestHello';
import { ResponseHello } from '../generated/filefarm/hello/ResponseHello';
import { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';

export function Service_Call_Hello(
    call: ServerUnaryCall<RequestHello, ResponseHello>,
    callback: sendUnaryData<ResponseHello>
) {
    const request: RequestHello = call.request;
    const response: ResponseHello = {
        text: `Hello, ${request.text}`
    };
    
    callback(null, response);
}
