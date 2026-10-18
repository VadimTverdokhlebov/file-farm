import { ServerUnaryCall, sendUnaryData, status } from '@grpc/grpc-js';
import { generateUUID } from '../utils/uuid';
import { GetUserRequest } from '../generated/filefarm/user/GetUserRequest';
import { GetUserResponse } from '../generated/filefarm/user/GetUserResponse';
import { CreateUserRequest } from '../generated/filefarm/user/CreateUserRequest';
import { CreateUserResponse } from '../generated/filefarm/user/CreateUserResponse';
import { recordGrpcRequestEnd, recordGrpcRequestStart } from '../utils/metrics';

interface IUser {
    login: string | undefined;
    name: string | undefined;
    id: string;
}

const users: Array<IUser> = [];

export function CreateUser(
    call: ServerUnaryCall<CreateUserRequest, CreateUserResponse>,
    callback: sendUnaryData<CreateUserResponse>
) {
    const request: CreateUserRequest = call.request;
    const startedAt = recordGrpcRequestStart();

    try {
        const newUUID = generateUUID();

        const user = {
            login: request.login,
            name: request.name,
            id: newUUID
        };

        const response: CreateUserResponse = {
            login: user.login,
            name: user.name,
            id: user.id
        };

        users.push(user);

        recordGrpcRequestEnd('CreateUser', 'ok', startedAt);
        callback(null, response);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to create user';
        recordGrpcRequestEnd('CreateUser', 'error', startedAt);
        callback({
            code: status.INTERNAL,
            details: errorMessage
        }, null);
    }
}

export function GetUser(
    call: ServerUnaryCall<GetUserRequest, GetUserResponse>,
    callback: sendUnaryData<GetUserResponse>
) {
    const request: GetUserRequest = call.request;
    const startedAt = recordGrpcRequestStart();

    try {
        const user = users.find(user => user.login === request.login);

        const response: GetUserResponse = {};

        if (user) {
            response.id = user.id;
            response.name = user.name;
        }

        recordGrpcRequestEnd('GetUser', 'ok', startedAt);
        callback(null, response);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to get user';
        recordGrpcRequestEnd('GetUser', 'error', startedAt);
        callback({
            code: status.INTERNAL,
            details: errorMessage
        }, null);
    }
}
