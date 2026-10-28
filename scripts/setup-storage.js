// Creates (or updates) the storage buckets Spent needs.
// Usage: npm run setup:storage
import { admin, BUCKETS } from '../src/supabase.js';

for (const { id, ...options } of BUCKETS) {
  const { data: existing } = await admin.storage.getBucket(id);
  const { error } = existing
    ? await admin.storage.updateBucket(id, options)
    : await admin.storage.createBucket(id, options);

  if (error) {
    console.error(`x ${id}: ${error.message}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${id} ${existing ? 'updated' : 'created'} (${options.public ? 'public' : 'private'})`);
  }
}
