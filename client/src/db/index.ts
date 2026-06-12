import { getDatabase } from './dbFactory';
import type { LocalDb } from './localDb';

type DrizzleDatabase = any;

let dbInstance: DrizzleDatabase | null = null;
let clientInstance: LocalDb | null = null;
let initPromise: Promise<void> | null = null;
let initFailed: boolean = false;

async function initializeDatabase() {
  // If init previously failed, allow retry
  if (initFailed) {
    initPromise = null;
    initFailed = false;
  }

  if (!initPromise) {
    console.log("[db/index] Creating new initPromise...");
    initPromise = (async () => {
      console.log("[db/index] Calling getDatabase()...");
      try {
        clientInstance = await getDatabase();
        console.log("[db/index] getDatabase() returned successfully");
        dbInstance = clientInstance;
      } catch (err) {
        console.error("[db/index] getDatabase() FAILED:", err);
        initFailed = true;
        dbInstance = null;
        clientInstance = null;
        throw err;
      }
    })();
  } else {
    console.log("[db/index] Reusing existing initPromise");
  }

  return initPromise;
}

// Export a function to get the database instance
export async function getDb() {
  console.log("[db/index] getDb() called");
  await initializeDatabase();
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  return dbInstance;
}

// Export a function to get the client instance
export async function getClient() {
  await initializeDatabase();
  if (!clientInstance) {
    throw new Error('Client not initialized');
  }
  return clientInstance;
}

// For backward compatibility, export a db object that throws if used before initialization
export const db = new Proxy({} as DrizzleDatabase, {
  get: () => {
    throw new Error('Database not initialized. Use getDb() instead.');
  },
});

export const client = new Proxy({} as LocalDb, {
  get: () => {
    throw new Error('Client not initialized. Use getClient() instead.');
  },
});
