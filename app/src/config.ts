// Public settings. The anon key is meant to be public: the notes tables are closed to it, and the
// notes functions (tools/notes/setup.sql) only answer to the key derived from the coach password.
export const SUPABASE_URL = "https://drzxqlptwizicihkdfbi.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyenhxbHB0d2l6aWNpaGtkZmJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5ODMzMzksImV4cCI6MjA4ODU1OTMzOX0.tJW2IlSlnYL97Vp0Q-ylAwu0vljhM2AAfB3DcsJstkI";

// Key-derivation settings for the coach password, shared with tools/build.mjs. Not secret.
import notesKdf from "../../tools/notes-kdf.json";
export const NOTES_KDF = { salt: notesKdf.salt, iterations: notesKdf.iterations };

// Key-derivation settings for the scorekeeper password, shared with tools/build.mjs. Not secret.
import keeperKdf from "../../tools/keeper-kdf.json";
export const KEEPER_KDF = { salt: keeperKdf.salt, iterations: keeperKdf.iterations };
