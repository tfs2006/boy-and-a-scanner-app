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

/**
 * Fetch frequency data from RadioReference's database via our API route.
 * Requires a 5-digit US ZIP code and the user's RR premium credentials.
 */
export const fetchFromRadioReference = async (
  zipcode: string,
  credentials: RRCredentials,
  serviceTypes: string[] = ['Police', 'Fire', 'EMS']
): Promise<ScanResult> => {
  const response = await fetch('/api/rrdb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      zipcode,
      rrUsername: credentials.username,
      rrPassword: credentials.password,
      serviceTypes
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `RadioReference API error (${response.status})`);
  }

  const result = await response.json();
  return result.data;
};