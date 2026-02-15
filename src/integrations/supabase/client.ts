// Backward-compatible export that uses the safe browser client implementation.
// This avoids startup crashes when VITE_SUPABASE_* env vars are missing.
export { supabase } from "./browserClient";
