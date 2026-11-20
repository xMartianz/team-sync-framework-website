// Konfigurasi koneksi Supabase untuk TeamSync.
// Isi dari Supabase Dashboard -> Project Settings -> API (atau Data API).
// "anon public key" memang aman ditaruh di browser: akses data dijaga oleh
// Row Level Security di supabase/schema.sql. JANGAN pernah menaruh service_role key di sini.
// Biarkan kosong untuk menjalankan mode pratinjau dengan data contoh (tanpa database).
window.TEAMSYNC_CONFIG = {
  supabaseUrl: "https://jubqfyoydfufwoatqqve.supabase.co",
  supabaseAnonKey: "sb_publishable_hSDi2LT9Zb28eaOqjKd3EQ_KPApibmt"
};
