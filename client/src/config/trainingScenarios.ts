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

export const trainingServerNames = [
  'file-farm-server-1',
  'file-farm-server-2',
  'file-farm-server-3',
  'file-farm-server-4',
];

export type ScenarioPhase = {
  name?: string;
  concurrency: number;
  durationSec: number;
  fileSizeMinKb: number;
  fileSizeMaxKb: number;
};

// Fixed load for watching how the model learns: one file size, endless run.
export type QuickPreset = {
  id: string;
  label: string;
  concurrency: number;
  duration: number;
  fileSizeMinKb: number;
  fileSizeMaxKb: number;
};

export type TrainingScenario = {
  id: string;
  name: string;
  summary: string;
  weakness: string;
  quickPresets?: QuickPreset[];
  endpoints: string[];
  concurrency: number;
  duration: number;
  fileSizeMinKb: number;
  fileSizeMaxKb: number;
  warmupFiles: number;
  randomOutages: boolean;
  outageServers: string[];
  outageMinSec: number;
  outageMaxSec: number;
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
    quickPresets: [
      {
        id: 'load-85-90',
        label: 'Средняя загрузка 85–90% от максимальной мощности: 28 клиентов, файл 512 КБ, без ограничения по времени',
        concurrency: 28,
        duration: 0,
        fileSizeMinKb: 512,
        fileSizeMaxKb: 512,
      },
      {
        id: 'load-55-60',
        label: 'Средняя загрузка 55–60% от максимальной мощности: 6 клиентов, файл 128 КБ, без ограничения по времени',
        concurrency: 6,
        duration: 0,
        fileSizeMinKb: 128,
        fileSizeMaxKb: 128,
      },
      {
        id: 'load-45-50',
        label: 'Средняя загрузка 45–50% от максимальной мощности: 3 клиента, файл 64 КБ, без ограничения по времени',
        concurrency: 3,
        duration: 0,
        fileSizeMinKb: 64,
        fileSizeMaxKb: 64,
      },
    ],
    endpoints: allEndpoints,
    concurrency: 36,
    duration: 180,
    fileSizeMinKb: 512,
    fileSizeMaxKb: 2048,
    warmupFiles: 8,
    randomOutages: false,
    outageServers: [],
    outageMinSec: 15,
    outageMaxSec: 40,
    waveIterations: 1,
    phases: [],
  },
  {
    id: 'server-dropout',
    name: 'Сервер выпадает',
    summary: 'Все методы. Случайный сервер из выбранных останавливается и через случайное время из диапазона запускается снова.',
    weakness:
      'Least request считает мёртвый сервер свободным и шлёт ему больше запросов. EMA принимает отсутствие задержки за быстрый ответ. Round robin и weighted round robin держат старую долю, пока не сработает проверка здоровья, и не готовятся к тому, что следующим упадёт уже другой сервер.',
    endpoints: allEndpoints,
    concurrency: 30,
    duration: 180,
    fileSizeMinKb: 256,
    fileSizeMaxKb: 1024,
    warmupFiles: 8,
    randomOutages: true,
    outageServers: [...trainingServerNames],
    outageMinSec: 15,
    outageMaxSec: 40,
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
    randomOutages: false,
    outageServers: [],
    outageMinSec: 15,
    outageMaxSec: 40,
    waveIterations: 1,
    phases: [
      { concurrency: 8, durationSec: 40, fileSizeMinKb: 256, fileSizeMaxKb: 512 },
      { concurrency: 48, durationSec: 50, fileSizeMinKb: 1024, fileSizeMaxKb: 2048 },
      { concurrency: 18, durationSec: 50, fileSizeMinKb: 2048, fileSizeMaxKb: maxTestFileSizeKb },
      { concurrency: 8, durationSec: 40, fileSizeMinKb: 256, fileSizeMaxKb: 512 },
    ],
  },
  {
    id: 'finale',
    name: 'Финал',
    summary: 'Один прогон: тихая нагрузка, скачок клиентов, крупные файлы и случайные остановки серверов.',
    weakness:
      'Классические алгоритмы ломаются в разных частях одного прогона. В тишине им хватает фиксированной доли по ядрам, на скачке серверы на 0,5 ядра упираются в потолок, на крупных файлах сервер с 512 МБ получает ту же долю, что и сервер с 1 ГБ, а после случайного падения мёртвый сервер ещё какое-то время получает вес. Модели нужно удержать каждый живой сервер ниже 95% CPU на всех этих сменах сразу.',
    endpoints: allEndpoints,
    concurrency: 36,
    duration: 210,
    fileSizeMinKb: 512,
    fileSizeMaxKb: 2048,
    warmupFiles: 8,
    randomOutages: true,
    outageServers: [...trainingServerNames],
    outageMinSec: 20,
    outageMaxSec: 45,
    waveIterations: 1,
    phases: [
      { name: 'Тихая нагрузка', concurrency: 36, durationSec: 60, fileSizeMinKb: 512, fileSizeMaxKb: 2048 },
      { name: 'Скачок клиентов', concurrency: 48, durationSec: 50, fileSizeMinKb: 1024, fileSizeMaxKb: 2048 },
      { name: 'Крупные файлы', concurrency: 18, durationSec: 60, fileSizeMinKb: 2048, fileSizeMaxKb: maxTestFileSizeKb },
      { name: 'Снова тишина', concurrency: 8, durationSec: 40, fileSizeMinKb: 256, fileSizeMaxKb: 512 },
    ],
  },
];

// Form values of a scenario, with the chosen quick preset laid over them.
export function scenarioValues(scenario: TrainingScenario, quickPresetId: string | null) {
  const preset = scenario.quickPresets?.find((item) => item.id === quickPresetId);
  return {
    concurrency: preset?.concurrency ?? scenario.concurrency,
    duration: preset?.duration ?? scenario.duration,
    fileSizeMinKb: preset?.fileSizeMinKb ?? scenario.fileSizeMinKb,
    fileSizeMaxKb: preset?.fileSizeMaxKb ?? scenario.fileSizeMaxKb,
  };
}

export function scenarioById(id: string): TrainingScenario {
  return trainingScenarios.find((scenario) => scenario.id === id) ?? trainingScenarios[0];
}
