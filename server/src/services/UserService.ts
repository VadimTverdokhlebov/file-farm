import { ServerUnaryCall, sendUnaryData } from '@grpc/grpc-js';
import { generateUUID } from '../utils/uuid';
import { GetUserRequest } from '../controller/UserPackage/GetUserRequest';
import { GetUserResponse } from '../controller/UserPackage/GetUserResponse';
import { CreateUserRequest } from '../controller/UserPackage/CreateUserRequest';
import { CreateUserResponse } from '../controller/UserPackage/CreateUserResponse';

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

    callback(null, response);
}

export function GetUser(
    call: ServerUnaryCall<GetUserRequest, GetUserResponse>,
    callback: sendUnaryData<GetUserResponse>
) {
    const request: GetUserRequest = call.request;
    
    console.log(users);

    const user = users.find(user => user.login === request.login);

    const response: GetUserResponse = {};

    if (user) {
        response.id = user.id;
        response.name = user.name;
    }

    callback(null, response);
}
