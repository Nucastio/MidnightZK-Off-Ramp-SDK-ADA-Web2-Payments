import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function packageRoot(name) {
  return dirname(dirname(dirname(require.resolve(name))));
}

const source = join(packageRoot("libsodium-sumo"), "dist/modules-sumo-esm/libsodium-sumo.mjs");
const destination = join(
  packageRoot("libsodium-wrappers-sumo"),
  "dist/modules-sumo-esm/libsodium-sumo.mjs",
);

if (existsSync(source) && !existsSync(destination)) {
  copyFileSync(source, destination);
  console.log("libsodium-sumo.mjs copied for libsodium-wrappers-sumo ESM.");
}
