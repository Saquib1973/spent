import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in server/.env');
}

// Admin client: bypasses RLS. Only ever used server-side.
export const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const publicConfig = {
  supabaseUrl: SUPABASE_URL,
  supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY,
};

export const BUCKETS = [
  {
    id: 'avatars',
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  {
    id: 'receipts',
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4', 'video/quicktime'],
  },
  { id: 'app-releases', public: true, fileSizeLimit: 50 * 1024 * 1024 },
];
