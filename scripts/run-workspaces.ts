import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface RootPackageJson {
  workspaces?: string[];
}

interface WorkspacePackageJson {
  name?: string;
  scripts?: Record<string, string>;
}

const scriptName = process.argv[2];

if (!scriptName) {
  throw new Error("Usage: bun scripts/run-workspaces.ts <script>");
}

const readJson = async <T>(path: string): Promise<T> => {
  return JSON.parse(await readFile(path, "utf8")) as T;
};

const workspaceDirectories = async (workspacePattern: string): Promise<string[]> => {
  if (!workspacePattern.endsWith("/*")) {
    throw new Error(`Unsupported workspace pattern: ${workspacePattern}`);
  }

  const parent = workspacePattern.slice(0, -2);
  const entries = await readdir(parent, { withFileTypes: true });

  return entries.filter((entry) => entry.isDirectory()).map((entry) => join(parent, entry.name));
};

const rootPackage = await readJson<RootPackageJson>("package.json");
const workspacePatterns = rootPackage.workspaces ?? [];
const workspacePaths = (await Promise.all(workspacePatterns.map(workspaceDirectories))).flat();

for (const workspacePath of workspacePaths) {
  const packagePath = join(workspacePath, "package.json");
  const packageJson = await readJson<WorkspacePackageJson>(packagePath);

  if (!packageJson.scripts?.[scriptName]) {
    continue;
  }

  const label = packageJson.name ?? workspacePath;
  console.log(`\n${label}: ${scriptName}`);

  const proc = Bun.spawn(["bun", "run", scriptName], {
    cwd: workspacePath,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
