const SUPABASE_URL = "https://giwzwmoaowabhxxxymho.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdpd3p3bW9hb3dhYmh4eHh5bWhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNzg3NzgsImV4cCI6MjA5MTc1NDc3OH0.Iy35MjUDsEOnzlRyqFC1YjxamjGOPSpdUjGiB8rAxV0";

let _client = null;

function sb() {
  if (!_client) {
    _client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _client;
}
