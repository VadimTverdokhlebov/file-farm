const upload = '/filefarm.file.FileService/UploadFile';
const download = '/filefarm.file.FileService/DownloadFile';
const deleteFile = '/filefarm.file.FileService/DeleteFile';
const compress = '/filefarm.file.FileService/CompressFile';
const createUser = '/filefarm.user.UserService/CreateUser';
const getUser = '/filefarm.user.UserService/GetUser';

// Every test calls all six requests.
export const testEndpoints = [upload, download, deleteFile, compress, createUser, getUser];

const grpcMessageBytes = 4 * 1024 * 1024;
const grpcMessageOverheadBytes = 64 * 1024;

// Largest raw file whose base64 body fits in the server's default 4 MB gRPC message.
export const maxTestFileSizeKb = Math.floor((((grpcMessageBytes - grpcMessageOverheadBytes) / 4) * 3) / 1024);

// Files created before the load starts, so downloads and deletes have something to work on.
export const testWarmupFiles = 8;

export const trainingServerNames = [
  'file-farm-server-1',
  'file-farm-server-2',
  'file-farm-server-3',
  'file-farm-server-4',
];

// A server taken down at stopAtSec of the test and started again at startAtSec.
export type ScheduledOutage = {
  server: string;
  stopAtSec: number;
  startAtSec: number;
};

// A load for the test: clients, file size and duration, with the server outages that go with it.
export type TestPreset = {
  id: string;
  label: string;
  concurrency: number;
  duration: number;
  fileSizeMinKb: number;
  fileSizeMaxKb: number;
  outages: ScheduledOutage[];
};

// Loads of the capacity-gap scenario (servers with 0.5, 1, 0.5 and 2 cores), each
// with a schedule of outages that can be edited before the start.
export const testPresets: TestPreset[] = [
  {
    id: 'load-85-90',
    label: '85–90%: 28 clients, 512 KB, 10 min. Server 3: stop 5 min, start 6 min',
    concurrency: 28,
    duration: 600,
    fileSizeMinKb: 512,
    fileSizeMaxKb: 512,
    outages: [{ server: 'file-farm-server-3', stopAtSec: 300, startAtSec: 360 }],
  },
  {
    id: 'load-85-90-s1',
    label: '85–90%: 28 clients, 512 KB, 10 min. Server 1: stop 3 min, start 6 min',
    concurrency: 28,
    duration: 600,
    fileSizeMinKb: 512,
    fileSizeMaxKb: 512,
    outages: [{ server: 'file-farm-server-1', stopAtSec: 180, startAtSec: 360 }],
  },
  {
    id: 'load-70-80',
    label: '70–80%: 24 clients, 128 KB, 10 min',
    concurrency: 24,
    duration: 600,
    fileSizeMinKb: 128,
    fileSizeMaxKb: 128,
    outages: [],
  },
  {
    id: 'load-55-60',
    label: '55–60%: 6 clients, 128 KB, 10 min. Server 1: stop 3 min, start 7 min. Server 3: stop 5 min, start 8 min',
    concurrency: 6,
    duration: 600,
    fileSizeMinKb: 128,
    fileSizeMaxKb: 128,
    outages: [
      { server: 'file-farm-server-1', stopAtSec: 180, startAtSec: 420 },
      { server: 'file-farm-server-3', stopAtSec: 300, startAtSec: 480 },
    ],
  },
  {
    id: 'load-45-50',
    label: '45–50%: 3 clients, 64 KB, 10 min. Server 4: stop 4 min, start 7 min',
    concurrency: 3,
    duration: 600,
    fileSizeMinKb: 64,
    fileSizeMaxKb: 64,
    outages: [{ server: 'file-farm-server-4', stopAtSec: 240, startAtSec: 420 }],
  },
];
