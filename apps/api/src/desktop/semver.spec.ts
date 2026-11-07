import { describe, expect, it } from 'vitest';
import { compareVersions, newestAbove, parseVersion } from './semver';

describe('desktop semver', () => {
  it('parses plain x.y.z and rejects anything else', () => {
    expect(parseVersion('1.10.0')).toEqual([1, 10, 0]);
    for (const bad of ['1.0', '1.0.0.0', '01.0.0', '1.0.0-beta', 'v1.0.0', '', ' 1.0.0']) {
      expect(parseVersion(bad)).toBeNull();
    }
  });

  it('compares numerically, not as text', () => {
    expect(compareVersions([1, 10, 0], [1, 9, 9])).toBeGreaterThan(0);
    expect(compareVersions([1, 0, 0], [1, 0, 0])).toBe(0);
    expect(compareVersions([0, 9, 9], [1, 0, 0])).toBeLessThan(0);
  });

  it('picks the newest candidate strictly above the current version', () => {
    const releases = [{ version: '1.2.0' }, { version: '1.10.0' }, { version: 'bad' }, { version: '1.0.0' }];
    expect(newestAbove(releases, [1, 0, 0])).toEqual({ version: '1.10.0' });
    expect(newestAbove(releases, [1, 10, 0])).toBeUndefined();
  });
});
