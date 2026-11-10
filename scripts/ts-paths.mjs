// Lets plain node run scripts that import app code by doing what vitest.config.ts does: "@/", extensionless .ts and "server-only".
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

const root = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return next(new URL("node_modules/server-only/empty.js", root).href, context);
    if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2), root).href;
    const local = specifier.startsWith(".") || specifier.startsWith("file:");
    if (local && !context.parentURL?.includes("/node_modules/") && !/\.[cm]?[jt]s$/.test(specifier)) {
      const base = new URL(specifier, context.parentURL).href;
      for (const ext of [".ts", "/index.ts"]) {
        if (existsSync(new URL(base + ext))) return next(base + ext, context);
      }
    }
    return next(specifier, context);
  },
});
