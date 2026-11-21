// Loads the public JSON files published by the pipeline (same origin only).

export const SUPPORTED_SCHEMA = 1;
const FILES = ['manifest', 'universe', 'signals', 'fx', 'rules', 'audit'];

export async function loadData(base = 'data/') {
  const docs = await Promise.all(
    FILES.map(async (name) => {
      const response = await fetch(`${base}${name}.json`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`${name}.json non disponibile (HTTP ${response.status})`);
      return response.json();
    }),
  );
  const data = Object.fromEntries(FILES.map((name, i) => [name, docs[i]]));
  if (data.manifest.schema_version !== SUPPORTED_SCHEMA) {
    throw new Error(`Versione dei dati non supportata: ${data.manifest.schema_version}`);
  }
  data.universeDoc = data.universe;
  data.universe = data.universe.instruments;
  return data;
}
