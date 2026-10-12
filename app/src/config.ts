// Public settings. The anon key is meant to be public: row-level security in Supabase
// (tools/notes/setup.sql) is what limits the notes table to the coaches' account.
export const SUPABASE_URL = "https://umwxiahvfqpdirhzirji.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtd3hpYWh2ZnFwZGlyaHppcmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMDYwNDUsImV4cCI6MjA4OTY4MjA0NX0.4-upV9QUw2gLjhqyzYJTXTgmCkrLn61xNE4kzWTcEOo";

// The one shared Supabase user all coaches sign in as. Its password is derived from the coach
// password (see lib/notesCrypto.ts), so Supabase never receives the coach password itself.
export const COACH_EMAIL = "coaches@dfc-game-film.app";

// Key-derivation settings for the coach password. Not secret; changing them breaks existing notes.
export const NOTES_KDF = { salt: "foq66j4u1iLA3WRLbh8m6g==", iterations: 600_000 };
