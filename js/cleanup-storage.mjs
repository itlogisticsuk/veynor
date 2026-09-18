// cleanup-storage.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://giwzwmoaowabhxxxymho.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdpd3p3bW9hb3dhYmh4eHh5bWhvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjE3ODc3OCwiZXhwIjoyMDkxNzU0Nzc4fQ.fUHIXBFLNOUQlfUGXy5YZ_4th7i7s4nCn6v--4zqoMc';

const supabase = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY
);

const { data: files, error } = await supabase
  .from('storage_cleanup_old_labels')
  .select('name');

if (error) {
  console.error('Fout bij ophalen:', error);
  process.exit(1);
}

console.log(`Te verwijderen: ${files.length} bestanden`);

const paths = files.map(x => x.name);

for (let i = 0; i < paths.length; i += 100) {
  const batch = paths.slice(i, i + 100);

  const { error: removeError } = await supabase.storage
    .from('order-documents')
    .remove(batch);

  if (removeError) {
    console.error('Fout bij verwijderen:', removeError);
    process.exit(1);
  }

  console.log(
    `Verwijderd ${Math.min(i + 100, paths.length)} / ${paths.length}`
  );
}

console.log('Cleanup voltooid.');