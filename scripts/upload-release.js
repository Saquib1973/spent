// Uploads a build (APK/AAB/IPA), promo video or screenshot to the public
// `app-releases` bucket so it appears on the download page.
// Usage: npm run upload:release -- path/to/spent.apk
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { admin } from '../src/supabase.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run upload:release -- <file>');
  process.exit(1);
}

const MIME = {
  '.apk': 'application/vnd.android.package-archive',
  '.aab': 'application/octet-stream',
  '.ipa': 'application/octet-stream',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

const name = basename(file);
const { error } = await admin.storage
  .from('app-releases')
  .upload(name, await readFile(file), {
    upsert: true,
    contentType: MIME[extname(name).toLowerCase()] ?? 'application/octet-stream',
  });

if (error) {
  console.error(error.message);
  process.exit(1);
}
const { data } = admin.storage.from('app-releases').getPublicUrl(name);
console.log(`Uploaded ${name}\n${data.publicUrl}`);
