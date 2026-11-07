/** `x.y.z` with numeric parts and no leading zeros (desktop_releases_version_check). */
const SEMVER = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

export type Version = readonly [number, number, number];

/** The numeric parts of a plain `x.y.z` version, or null when malformed. */
export function parseVersion(value: string): Version | null {
  const match = SEMVER.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Negative, zero or positive as a is older, equal or newer than b. */
export function compareVersions(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The newest of `candidates` strictly newer than `current`; malformed candidates are ignored. */
export function newestAbove<T extends { version: string }>(candidates: readonly T[], current: Version): T | undefined {
  let best: { item: T; version: Version } | undefined;
  for (const item of candidates) {
    const version = parseVersion(item.version);
    if (version && compareVersions(version, current) > 0 && (!best || compareVersions(version, best.version) > 0)) {
      best = { item, version };
    }
  }
  return best?.item;
}
