import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

/**
 * 本番ビルドにだけ CSP を入れる。貼り付けた設定がページの外へ送られないよう、
 * 通信（connect-src）と外部リソースを一切許可しない。
 * 開発サーバーは HMR の WebSocket を使うので入れない。
 */
const csp: Plugin = {
  name: "ccpick-csp",
  apply: "build",
  transformIndexHtml(html) {
    const policy = [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");
    return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
  },
};

export default defineConfig({
  base: "./",
  plugins: [csp],
  resolve: {
    alias: {
      "@ccpick/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    modulePreload: { polyfill: false },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
} as Parameters<typeof defineConfig>[0]);
