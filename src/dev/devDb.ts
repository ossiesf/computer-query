// The dev-mode IndexedDB database (one per browser). Data never leaves the device.
//   loads:     one record per model load (timings)
//   styleRuns: one record per style check (verdicts, rewrites, timings, your ✓/✗ label)

const DB_NAME = "computer-query-dev";
const DB_VERSION = 2; // v1 had only "loads"

export type StoreName = "loads" | "styleRuns";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase>
{
  dbPromise ??= new Promise((resolve, reject) =>
  {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () =>
    {
      const db = request.result;

      for (const name of ["loads", "styleRuns"] satisfies StoreName[])
      {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function withStore<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T>
{
  const db = await openDb();

  return new Promise((resolve, reject) =>
  {
    const tx = db.transaction(name, mode);
    const request = run(tx.objectStore(name));

    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}

/** add / get / put / all / clear for one store. `add` returns the new record's id. */
export function devStore<T extends { id?: number }>(name: StoreName)
{
  return {
    add: (record: T) => withStore(name, "readwrite", (s) => s.add(record)) as Promise<number>,
    get: (id: number) => withStore<T | undefined>(name, "readonly", (s) => s.get(id)),
    put: (record: T) => withStore(name, "readwrite", (s) => s.put(record)),
    all: () => withStore<T[]>(name, "readonly", (s) => s.getAll()),
    clear: () => withStore(name, "readwrite", (s) => s.clear()),
  };
}
