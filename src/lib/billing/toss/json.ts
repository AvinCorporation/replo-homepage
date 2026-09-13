function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalJson(item)}`,
      )
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("NON_JSON_VALUE");
  return serialized;
}

export function sameJsonValue(left: unknown, right: unknown) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}
