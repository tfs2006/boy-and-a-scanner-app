type SupabaseLikeError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  status?: number;
};

const SESSION_KEY_PREFIX = 'supabase_missing_table:';

function getSessionKey(tableName: string) {
  return `${SESSION_KEY_PREFIX}${tableName}`;
}

export function shouldSkipOptionalTable(tableName: string): boolean {
  try {
    return sessionStorage.getItem(getSessionKey(tableName)) === '1';
  } catch {
    return false;
  }
}

export function isMissingOptionalTableError(error: SupabaseLikeError | null | undefined): boolean {
  if (!error) return false;

  const combinedMessage = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase();

  return (
    error.status === 404 ||
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    combinedMessage.includes('could not find the table') ||
    combinedMessage.includes('relation') && combinedMessage.includes('does not exist')
  );
}

export function rememberMissingOptionalTable(tableName: string, error: SupabaseLikeError | null | undefined): boolean {
  if (!isMissingOptionalTableError(error)) return false;

  try {
    sessionStorage.setItem(getSessionKey(tableName), '1');
  } catch {
    // Ignore storage failures; fallback behavior still applies for this request.
  }

  return true;
}