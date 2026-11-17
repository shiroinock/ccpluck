import { isPlainObject, isStringArray, type JsonValue, type Settings, type Warning } from "./json.js";
import { PERMISSION_SET_KEYS } from "./items.js";
import { PERMISSIONS_KEYS, TOP_LEVEL_KEYS, type SchemaKeyInfo } from "./schema-snapshot.js";

export interface ValidationResult {
  ok: boolean;
  /** 書き込みを止めるべき構造上の誤り */
  errors: string[];
  /** スキーマにないキーや型の食い違い。スキーマは最新の CLI より遅れるので警告にとどめる */
  warnings: Warning[];
}

function typeMatches(info: SchemaKeyInfo, v: JsonValue): boolean {
  switch (info.type) {
    case null:
      return true;
    case "string":
      return typeof v === "string";
    case "boolean":
      return typeof v === "boolean";
    case "integer":
      return Number.isInteger(v);
    case "number":
      return typeof v === "number";
    case "array":
      return Array.isArray(v);
    case "object":
      return isPlainObject(v);
    default:
      return true;
  }
}

/**
 * 書き込み前の検証。Claude Code が読めなくなる壊れ方だけを errors にする。
 */
export function validateSettings(value: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: Warning[] = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: ["settings はオブジェクトである必要があります"], warnings };
  }
  const s = value as Settings;

  for (const [k, v] of Object.entries(s)) {
    const info = Object.hasOwn(TOP_LEVEL_KEYS, k) ? TOP_LEVEL_KEYS[k] : undefined;
    if (!info) {
      warnings.push({ code: "unknown-key", message: `スキーマにないキーです: ${k}`, at: `/${k}` });
    } else if (!typeMatches(info, v)) {
      warnings.push({ code: "type-mismatch", message: `${k} の型がスキーマ (${info.type}) と違います`, at: `/${k}` });
    }
  }

  if (s.permissions !== undefined) {
    if (!isPlainObject(s.permissions)) errors.push("permissions はオブジェクトである必要があります");
    else {
      for (const [k, v] of Object.entries(s.permissions)) {
        if (PERMISSION_SET_KEYS.has(k) && !isStringArray(v)) errors.push(`permissions.${k} は文字列の配列である必要があります`);
        if (!Object.hasOwn(PERMISSIONS_KEYS, k)) {
          warnings.push({ code: "unknown-key", message: `スキーマにないキーです: permissions.${k}`, at: `/permissions/${k}` });
        }
      }
    }
  }

  if (s.env !== undefined) {
    if (!isPlainObject(s.env)) errors.push("env はオブジェクトである必要があります");
    else {
      for (const [k, v] of Object.entries(s.env)) {
        if (typeof v !== "string") {
          warnings.push({ code: "type-mismatch", message: `env.${k} の値は文字列にしてください`, at: `/env/${k}` });
        }
      }
    }
  }

  if (s.hooks !== undefined) {
    if (!isPlainObject(s.hooks)) errors.push("hooks はオブジェクトである必要があります");
    else {
      for (const [event, groups] of Object.entries(s.hooks)) {
        if (!Array.isArray(groups)) {
          errors.push(`hooks.${event} は配列である必要があります`);
          continue;
        }
        groups.forEach((g, i) => {
          if (!isPlainObject(g)) errors.push(`hooks.${event}[${i}] はオブジェクトである必要があります`);
          else if (!Array.isArray(g.hooks) || !g.hooks.every(isPlainObject)) {
            errors.push(`hooks.${event}[${i}].hooks はオブジェクトの配列である必要があります`);
          } else if (g.matcher !== undefined && typeof g.matcher !== "string") {
            errors.push(`hooks.${event}[${i}].matcher は文字列である必要があります`);
          }
        });
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
