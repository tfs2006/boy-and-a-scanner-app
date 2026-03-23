import { ScanResult } from '../types';

/**
 * Client-side service to call the RadioReference SOAP API
 * via our secure serverless endpoint (/api/rrdb).
 * 
 * The RR App Key stays server-side. The user's RR credentials
 * are passed through but never stored on the server.
 */

export interface RRCredentials {
  username: string;
  password: string;
}

const RR_REQUEST_TIMEOUT_MS = 45_000;

function createRequestSignal(timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  const handleAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', handleAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    didTimeout: () => controller.signal.aborted && !signal?.aborted,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      if (signal) signal.removeEventListener('abort', handleAbort);
    },
  };
}

/**
 * Fetch frequency data from RadioReference's database via our API route.
 * Requires a 5-digit US ZIP code and the user's RR premium credentials.
 */
export const fetchFromRadioReference = async (
  zipcode: string,
  credentials: RRCredentials,
  serviceTypes: string[] = ['Police', 'Fire', 'EMS'],
  signal?: AbortSignal
): Promise<ScanResult> => {
  const { signal: requestSignal, didTimeout, cleanup } = createRequestSignal(RR_REQUEST_TIMEOUT_MS, signal);

  let response: Response;
  try {
    response = await fetch('/api/rrdb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: requestSignal,
      body: JSON.stringify({
        zipcode,
        rrUsername: credentials.username,
        rrPassword: credentials.password,
        serviceTypes
      })
    });
  } catch (error) {
    cleanup();
    if (didTimeout()) {
      throw new Error('RadioReference request timed out');
    }
    throw error;
  }

  cleanup();

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const err = new Error(errorData.error || `RadioReference API error (${response.status})`);
    (err as any).rrErrorCode = errorData.errorCode || 'RR_UNAVAILABLE';
    throw err;
  }

  const result = await response.json();
  return result.data;
};