import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const schema = process.argv.find((argument) => argument.startsWith("--schema="))?.slice(9)
  ?? fileURLToPath(new URL("../../api/openapi.yaml", import.meta.url));
const output = fileURLToPath(new URL("../src/api/schema.d.ts", import.meta.url));
const args = [
  "exec", "--yes", "--package=openapi-typescript@7.13.0", "--package=typescript@5.9.3", "--",
  "openapi-typescript", schema, "--output", output,
];
if (process.argv.includes("--check")) args.push("--check");

const result = spawnSync("npm", args, { stdio: "inherit" });
process.exitCode = result.status ?? 1;
