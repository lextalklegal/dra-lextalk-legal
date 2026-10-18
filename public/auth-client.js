/* Managed authentication client. Supabase owns passwords, email confirmation and session refresh. */
(function () {
  const config = window.DRA_AUTH_CONFIG || {};
  const url = String(config.url || '').trim().replace(/\/+$/, '');
  const key = String(config.publishableKey || '').trim();
  const isConfigured = /^https:\/\//i.test(url) && !url.includes('YOUR-PROJECT-REF') &&
    key.length >= 20 && !key.includes('YOUR_SUPABASE_') &&
    window.supabase && typeof window.supabase.createClient === 'function';
  if (!isConfigured) {
    window.draSupabase = null;
    window.draAuthConfigured = false;
    return;
  }
  window.draSupabase = window.supabase.createClient(url, key, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  });
  window.draAuthConfigured = true;
})();
