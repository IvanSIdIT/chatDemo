export function isValidDocumentSource(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed || trimmed.length > 255) {
    return false;
  }

  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return false;
  }

  return trimmed.toLowerCase().endsWith(".pdf");
}

export function matchesRagDocumentSource(objectName: string, source: string): boolean {
  const suffix = `-${source}`;
  return objectName === source || objectName.endsWith(suffix);
}

export function listMatchingStorageObjectNames(objectNames: string[], source: string): string[] {
  return objectNames.filter((name) => matchesRagDocumentSource(name, source));
}

export function toRagStoragePaths(objectNames: string[]): string[] {
  return objectNames.map((name) => `uploads/${name}`);
}
