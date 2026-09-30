// Resource ids become directory names when a resource is projected into a seat.
// Qualified ids look like "shared:openrig-core", and Windows forbids ":" (and a few
// other characters) in a file name, so mkdir fails there. On win32 these characters are
// percent-escaped; "%" is escaped too, which makes fromFsSafeName an exact inverse.
// Other platforms keep the id unchanged, so existing installs do not move.

const WINDOWS_UNSAFE = /[<>:"|?*%]/g;
const WINDOWS_ESCAPED = /%(3C|3E|3A|22|7C|3F|2A|25)/g;

export function toFsSafeName(id: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return id;
  return id.replace(WINDOWS_UNSAFE, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function fromFsSafeName(name: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return name;
  return name.replace(WINDOWS_ESCAPED, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
