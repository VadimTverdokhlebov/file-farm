const upload = '/filefarm.file.FileService/UploadFile';
const download = '/filefarm.file.FileService/DownloadFile';
const deleteFile = '/filefarm.file.FileService/DeleteFile';
const compress = '/filefarm.file.FileService/CompressFile';
const createUser = '/filefarm.user.UserService/CreateUser';
const getUser = '/filefarm.user.UserService/GetUser';

const allEndpoints = [upload, download, deleteFile, compress, createUser, getUser];

const grpcMessageBytes = 4 * 1024 * 1024;
const grpcMessageOverheadBytes = 64 * 1024;

// Largest raw file whose base64 body fits in the server's default 4 MB gRPC message.
export const maxTestFileSizeKb = Math.floor((((grpcMessageBytes - grpcMessageOverheadBytes) / 4) * 3) / 1024);

export type ScenarioPhase = {
  concurrency: number;
  durationSec: number;
  fileSizeMinKb: number;
  fileSizeMaxKb: number;
};

export type TrainingScenario = {
  id: string;
  name: string;
  summary: string;
  weakness: string;
  endpoints: string[];
  concurrency: number;
  duration: number;
  fileSizeMinKb: number;
  fileSizeMaxKb: number;
  warmupFiles: number;
  stopServer: string;
  stopAfterSec: number;
  waveIterations: number;
  phases: ScenarioPhase[];
};

export const trainingScenarios: TrainingScenario[] = [
  {
    id: 'capacity-gap',
    name: 'Разрыв по мощности',
    summary: 'Все методы на серверах с 0,5, 1, 0,5 и 2 ядрами. Сжатие и загрузка упираются в процессор.',
    weakness:
      'Round robin и least request делят трафик поровну, поэтому серверы на половину ядра упираются в потолок, а сервер на 2 ядра простаивает. EMA уходит на тот сервер, который на мгновение быстрее, и может завалить маленький. Weighted round robin не снимает вес, когда процессор переходит 90%.',
    endpoints: allEndpoints,
    concurrency: 36,
    duration: 180,
    fileSizeMinKb: 512,
    fileSizeMaxKb: 2048,
    warmupFiles: 8,
    stopServer: '',
    stopAfterSec: 0,
    waveIterations: 1,
    phases: [],
  },
  {
    id: 'tight-memory',
    name: 'Тесная память',
    summary: 'Все методы и самые крупные файлы, которые ещё помещаются в лимит сообщения 4 МБ.',
    weakness:
      'Round robin и least request дают серверу с 512 МБ ту же долю, что и серверу с 1,5 ГБ, поэтому он исчерпывает память и начинает отвечать ошибками. EMA реагирует только когда задержка уже высокая. Weighted round robin держит фиксированную долю и после начала ошибок.',
    endpoints: allEndpoints,
    concurrency: 24,
    duration: 180,
    fileSizeMinKb: 2048,
    fileSizeMaxKb: maxTestFileSizeKb,
    warmupFiles: 8,
    stopServer: '',
    stopAfterSec: 0,
    waveIterations: 1,
    phases: [],
  },
  {
    id: 'server-dropout',
    name: 'Сервер выпадает',
    summary: 'Все методы, затем один сервер останавливается и в конце теста запускается снова.',
    weakness:
      'Least request считает мёртвый сервер свободным и шлёт ему больше запросов. EMA принимает отсутствие задержки за быстрый ответ. Round robin и weighted round robin держат старую долю, пока не сработает проверка здоровья.',
    endpoints: allEndpoints,
    concurrency: 30,
    duration: 150,
    fileSizeMinKb: 256,
    fileSizeMaxKb: 1024,
    warmupFiles: 8,
    stopServer: 'file-farm-server-1',
    stopAfterSec: 40,
    waveIterations: 1,
    phases: [],
  },
  {
    id: 'client-waves',
    name: 'Волны клиентов',
    summary: 'Все методы. Число клиентов и размер файлов меняются волнами: тишина, скачок, крупные файлы, снова тишина.',
    weakness:
      'В тихой волне выгодная доля совпадает с weighted round robin: вес пропорционален ядрам. На скачке серверы на 0,5 ядра насыщаются, а у сервера на 2 ядра остаётся запас — фиксированные веса не могут временно отдать ему больше половины. На волне крупных файлов серверы с одинаковым числом ядер получают одинаковый вес, хотя у одного 512 МБ, а у другого 1 ГБ. Модель на пике уводит вес по загрузке и ошибкам, а в тишине возвращается к распределению по мощности.',
    endpoints: allEndpoints,
    concurrency: 8,
    duration: 180,
    fileSizeMinKb: 256,
    fileSizeMaxKb: 512,
    warmupFiles: 8,
    stopServer: '',
    stopAfterSec: 0,
    waveIterations: 1,
    phases: [
      { concurrency: 8, durationSec: 40, fileSizeMinKb: 256, fileSizeMaxKb: 512 },
      { concurrency: 48, durationSec: 50, fileSizeMinKb: 1024, fileSizeMaxKb: 2048 },
      { concurrency: 18, durationSec: 50, fileSizeMinKb: 2048, fileSizeMaxKb: maxTestFileSizeKb },
      { concurrency: 8, durationSec: 40, fileSizeMinKb: 256, fileSizeMaxKb: 512 },
    ],
  },
];

export function scenarioById(id: string): TrainingScenario {
  return trainingScenarios.find((scenario) => scenario.id === id) ?? trainingScenarios[0];
}
