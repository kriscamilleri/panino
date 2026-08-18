import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate as validateUuid } from "uuid";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.resolve(moduleDir, "uploads", "spaces");

export function resolveSpaceUploadRoot(spaceId) {
  if (typeof spaceId !== "string" || !validateUuid(spaceId)) {
    throw new Error("Space id must be a UUID");
  }
  const resolved = path.resolve(uploadsRoot, spaceId);
  if (!resolved.startsWith(`${uploadsRoot}${path.sep}`)) {
    throw new Error("Space upload path escaped its root");
  }
  return resolved;
}

export function deleteSpaceUploads(spaceId) {
  const target = resolveSpaceUploadRoot(spaceId);
  if (!fs.existsSync(target)) return { removed: false };
  fs.rmSync(target, { recursive: true, force: false });
  return { removed: true };
}

