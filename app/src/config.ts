// Public settings. The anon key is meant to be public: the notes tables are closed to it, and the
// notes functions (tools/notes/setup.sql) only answer to the key derived from the coach password.
export const SUPABASE_URL = "https://umwxiahvfqpdirhzirji.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtd3hpYWh2ZnFwZGlyaHppcmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMDYwNDUsImV4cCI6MjA4OTY4MjA0NX0.4-upV9QUw2gLjhqyzYJTXTgmCkrLn61xNE4kzWTcEOo";

// Key-derivation settings for the coach password, shared with tools/build.mjs. Not secret.
import notesKdf from "../../tools/notes-kdf.json";
export const NOTES_KDF = { salt: notesKdf.salt, iterations: notesKdf.iterations };
