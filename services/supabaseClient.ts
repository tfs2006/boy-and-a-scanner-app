
import { createClient } from '@supabase/supabase-js';

// Helper to safely access process.env without crashing in browsers where process is undefined
const getEnv = (key: string) => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return undefined;
};

// Configuration from user
const supabaseUrl = getEnv("SUPABASE_URL") || "https://uzzagbmksrqwzrnnsacm.supabase.co";

// We use the environment variable if available, otherwise we use the key you provided.
// Note: It is safe to expose the 'anon' key in the browser as long as your database has RLS (Row Level Security) enabled.
const supabaseKey = getEnv("SUPABASE_ANON_KEY") || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6emFnYm1rc3Jxd3pybm5zYWNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyMTc3MTYsImV4cCI6MjA4NTc5MzcxNn0.N7nJ6LC-sDfru3n7lONsbBsw699BirkneFkcgczCi7I";

if (!supabaseKey) {
  console.warn("Supabase Access Key missing.");
}

export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;
