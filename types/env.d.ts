// Test-only env vars passed to spawned migration runners.
declare namespace NodeJS {
  interface ProcessEnv {
    MORSE_MIGRATIONS_DIR?: string;
  }
}
