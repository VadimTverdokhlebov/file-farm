import logger from '../utils/logger';
import { RequestHello } from '../controller/HelloServicePackage/RequestHello';
import { ResponseHello } from '../controller/HelloServicePackage/ResponseHello';
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
