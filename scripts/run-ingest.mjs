import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ingestScript = join(projectRoot, "ingest.py");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  return result.status ?? 1;
}

const windowsPython = join(
  process.env.LOCALAPPDATA ?? "",
  "Programs",
  "Python",
  "Python311",
  "python.exe",
);

if (process.platform === "win32" && existsSync(windowsPython)) {
  process.exit(run(windowsPython, [ingestScript]));
}

if (process.platform === "win32") {
  const pyLauncher = run("py", ["-3", ingestScript]);
  if (pyLauncher === 0) {
    process.exit(0);
  }
}

const unixPython = run("python3", [ingestScript]);
if (unixPython === 0) {
  process.exit(0);
}

console.error(
  [
    "Could not find Python.",
    "Install Python 3.11+ and run:",
    "  py -3 ingest.py",
    "Or set PYTHON_PATH to your python.exe and rerun npm run ingest.",
  ].join("\n"),
);
process.exit(1);
