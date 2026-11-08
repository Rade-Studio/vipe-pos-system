type Line = Record<string, unknown>;

const isRecord = (value: unknown): value is Line => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * F7: printers read a line's options as `modifiers [{group, name, price}]`
 * (pos/print_renderer.py, desktop/core). Web lines carry the order snapshot
 * `{groupId, groupName, optionId, name, price}`, so those entries are mapped
 * to the print shape; a line without options, one already in the print shape
 * and malformed values are kept as sent.
 */
export function printLines<T extends Line>(items: readonly T[]): T[] {
  return items.map((item) => {
    const modifiers = item.modifiers;
    if (!Array.isArray(modifiers) || !modifiers.some((m) => isRecord(m) && 'groupName' in m && !('group' in m))) {
      return item;
    }
    return {
      ...item,
      modifiers: modifiers.map((m) =>
        isRecord(m) && 'groupName' in m && !('group' in m) ? { group: m.groupName, name: m.name, price: m.price } : m,
      ),
    };
  });
}
