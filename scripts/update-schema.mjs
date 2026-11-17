// JSON Schema (schemastore) から packages/core/src/schema-snapshot.ts を再生成する。
// 使い方: pnpm update-schema
import { writeFileSync } from "node:fs";

const SCHEMA_URL = "https://json.schemastore.org/claude-code-settings.json";
const res = await fetch(SCHEMA_URL);
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const schema = await res.json();

const pick = (props) =>
  Object.fromEntries(
    Object.entries(props ?? {}).map(([k, v]) => [
      k,
      {
        type: typeof v.type === "string" ? v.type : null,
        description: String(v.description ?? "").split(". See http")[0].slice(0, 300),
      },
    ]),
  );

const top = pick(schema.properties);
const perm = pick(schema.properties?.permissions?.properties);

const src = `// 自動生成: scripts/update-schema.mjs で更新する。手で編集しない。
// source: ${SCHEMA_URL}

export interface SchemaKeyInfo {
  type: string | null;
  description: string;
}

export const TOP_LEVEL_KEYS: Record<string, SchemaKeyInfo> = ${JSON.stringify(top, null, 2)};

export const PERMISSIONS_KEYS: Record<string, SchemaKeyInfo> = ${JSON.stringify(perm, null, 2)};
`;
writeFileSync(new URL("../packages/core/src/schema-snapshot.ts", import.meta.url), src);
console.log(`updated: ${Object.keys(top).length} top-level keys`);
