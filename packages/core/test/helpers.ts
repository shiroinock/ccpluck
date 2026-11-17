import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Settings } from "../src/index.js";

const dir = join(import.meta.dirname, "fixtures");

export const fixtureNames = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

export function loadFixture(name: string): Settings {
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as Settings;
}

export const fixtures: [string, Settings][] = fixtureNames.map((n) => [n, loadFixture(n)]);
