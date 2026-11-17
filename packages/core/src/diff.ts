import { deepEqual, type Settings } from "./json.js";
import { decompose, type Item } from "./items.js";

export interface ItemDiff {
  added: Item[];
  removed: Item[];
  changed: { id: string; before: Item; after: Item }[];
  unchanged: Item[];
}

/** 項目単位の差分。配列の並び替えだけでは差分にならない。 */
export function diffSettings(before: Settings, after: Settings): ItemDiff {
  return diffItems(decompose(before).items, decompose(after).items);
}

export function diffItems(before: Item[], after: Item[]): ItemDiff {
  const b = new Map(before.map((i) => [i.id, i]));
  const a = new Map(after.map((i) => [i.id, i]));
  const diff: ItemDiff = { added: [], removed: [], changed: [], unchanged: [] };
  for (const item of after) {
    const prev = b.get(item.id);
    if (!prev) diff.added.push(item);
    else if (deepEqual(prev.value, item.value) && deepEqual(prev.hook?.groupExtra, item.hook?.groupExtra))
      diff.unchanged.push(item);
    else diff.changed.push({ id: item.id, before: prev, after: item });
  }
  for (const item of before) if (!a.has(item.id)) diff.removed.push(item);
  return diff;
}
