import { mkdtempSync, statSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, expect } from "vitest";

/**
 * テストが実ユーザーのホームディレクトリに書き込まないようにする。
 * - HOME / CLAUDE_CONFIG_DIR / CCPICK_HOME を一時ディレクトリに向ける
 * - テストの前後で本物の ~/.claude/settings.json と ~/.ccpick が変わっていないことを確かめる
 */
const realHome = userInfo().homedir;
const watched = [join(realHome, ".claude", "settings.json"), join(realHome, ".ccpick")];
const snapshot = () =>
  watched.map((p) => {
    try {
      const st = statSync(p);
      return `${p}:${st.mtimeMs}:${st.size}`;
    } catch {
      return `${p}:absent`;
    }
  });
const before = snapshot();

const fakeHome = mkdtempSync(join(tmpdir(), "ccpick-home-"));
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
process.env.CLAUDE_CONFIG_DIR = join(fakeHome, ".claude");
process.env.CCPICK_HOME = join(fakeHome, ".ccpick");

afterAll(() => {
  expect(snapshot()).toEqual(before);
});
