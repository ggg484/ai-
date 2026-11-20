import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { deserialize, serialize } from "node:v8";
import { randomUUID } from "node:crypto";

// The file contains local game data only; transient Room and credential state stays in memory.
export function createPersistence(file, gameId) {
  if (!file) return { load: () => undefined, save() {} };
  return {
    load() {
      try {
        const snapshot = deserialize(readFileSync(file));
        if (snapshot?.version !== 1 || ![snapshot.gameData?.objects, snapshot.gameData?.counters,
          snapshot.gameData?.scores, snapshot.gameData?.receipts, snapshot.economy?.store,
          snapshot.economy?.targetRevisions, snapshot.economy?.orders].every((value) => value instanceof Map)) {
          throw new Error("Unsupported local data format");
        }
        if (gameId !== undefined && snapshot.gameId !== gameId) throw new Error("Local Mock data belongs to another game; choose a different data file");
        return snapshot;
      } catch (error) {
        if (error?.code === "ENOENT") return undefined;
        throw new Error(`Cannot read local Mock data: ${error.message}`);
      }
    },
    save(snapshot) {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, serialize({ version: 1, gameId, ...snapshot }), { mode: 0o600, flag: "wx" });
        renameSync(temporary, file);
      } catch (error) {
        try { unlinkSync(temporary); } catch {}
        throw new Error(`Cannot save local Mock data: ${error.message}`);
      }
    },
  };
}
