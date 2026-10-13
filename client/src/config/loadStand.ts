export function getLoadStandHttpUrl(): string {
  return import.meta.env.VITE_LOAD_STAND_URL || 'http://localhost:8081';
}

export function getLoadStandWsUrl(): string {
  const httpUrl = getLoadStandHttpUrl();
  const wsBase = httpUrl.replace(/^http/i, 'ws');
  return `${wsBase}/ws`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    throw new Error(
      'Load stand returned HTML instead of JSON. Check VITE_LOAD_STAND_URL and run: make up-load-stand'
    );
  }

  return response.json() as Promise<T>;
}

export async function postLoadStandJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getLoadStandHttpUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = (await response.text()).trim();
    throw new Error(message || `Load stand request failed (${response.status})`);
  }

  return parseJsonResponse<T>(response);
}

export async function fetchLoadStandJson<T>(path: string): Promise<T> {
  const response = await fetch(`${getLoadStandHttpUrl()}${path}`);

  if (!response.ok) {
    throw new Error(`Load stand request failed (${response.status}). Run: make up-load-stand`);
  }

  return parseJsonResponse<T>(response);
}
