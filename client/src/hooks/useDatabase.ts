import { useEffect, useState } from "react";
import { getDb } from "@/db";
import type { LocalDb } from "@/db/localDb";

export function useDatabase() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [db, setDb] = useState<LocalDb | null>(null);

  useEffect(() => {
    const initDatabase = async () => {
      try {
        console.log("[useDatabase] Step 1: About to call getDb()...");
        const database = await getDb();
        console.log("[useDatabase] Step 2: getDb() returned:", database);
        console.log("[useDatabase] Step 3: isReady:", database?.isReady?.());
        setDb(database as any);
        setIsInitialized(true);
        console.log("[useDatabase] Step 4: Done!");
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to initialize database"));
        console.error("[useDatabase] FAILED:", err);
      }
    };

    initDatabase();
  }, []);

  return { isInitialized, error, db: db as any };
}
