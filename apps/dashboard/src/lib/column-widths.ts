/**
 * Column widths for a fixed-layout table (R-DASH-21). Action columns take their pixels,
 * data columns share what is left in proportion to their weight, and no data column
 * goes below its floor (its widest header word) while wider columns still have room to
 * give. When even the floors do not fit, every floor scales down together and header
 * words wrap instead of the table overflowing. Widths are whole pixels whose sum is
 * exactly the whole-pixel container width, so the browser never has a fraction to round
 * up: leftover pixels go to the columns that lost the most to flooring.
 */
export interface ColumnSpec {
  /** Pixel width of an action column; 0 for a data column. */
  fixed: number;
  /** The narrowest a data column may be; 0 for an action column. */
  floor: number;
  /** Relative width of a data column; 0 for an action column. */
  weight: number;
}
/** Fractional targets before rounding: fixed pixels, then weights with pinned floors. */
function targets(specs: readonly ColumnSpec[], available: number): number[] {
  const floorTotal = specs.reduce((sum, spec) => sum + spec.floor, 0);
  if (floorTotal >= available) {
    const scale = floorTotal === 0 ? 0 : available / floorTotal;
    return specs.map((spec) => spec.floor * scale);
  }
  const widths = specs.map(() => 0);
  let flexible = specs
    .map((spec, index) => index)
    .filter((index) => (specs[index]?.weight ?? 0) > 0);
  let room = available;
  // Pin every column that would fall under its floor, then share what is left again.
  while (flexible.length > 0) {
    const weightTotal = flexible.reduce(
      (sum, index) => sum + (specs[index]?.weight ?? 0),
      0,
    );
    const share = (index: number) =>
      ((specs[index]?.weight ?? 0) / weightTotal) * room;
    const pinned = flexible.filter(
      (index) => share(index) < (specs[index]?.floor ?? 0),
    );
    if (pinned.length === 0) {
      for (const index of flexible) widths[index] = share(index);
      break;
    }
    for (const index of pinned) {
      const floor = specs[index]?.floor ?? 0;
      widths[index] = floor;
      room -= floor;
    }
    flexible = flexible.filter((index) => !pinned.includes(index));
  }
  return widths;
}
export function columnWidths(
  specs: readonly ColumnSpec[],
  containerWidth: number,
): number[] {
  const total = Math.max(0, Math.floor(containerWidth));
  const fixed = specs.map((spec) => Math.max(0, Math.floor(spec.fixed)));
  const fixedTotal = fixed.reduce((sum, width) => sum + width, 0);
  const available = Math.max(0, total - fixedTotal);
  const fractional = targets(
    specs.map((spec, index) =>
      fixed[index] ? { fixed: fixed[index], floor: 0, weight: 0 } : spec,
    ),
    available,
  );
  const whole = fractional.map((width) => Math.floor(width));
  // Largest-remainder rounding: the spare pixels go where flooring cut the most.
  let spare = available - whole.reduce((sum, width) => sum + width, 0);
  const order = fractional
    .map((width, index) => ({ index, lost: width - Math.floor(width) }))
    .filter(({ index }) => !fixed[index])
    .sort((a, b) => b.lost - a.lost || a.index - b.index);
  for (const { index } of order) {
    if (spare <= 0) break;
    whole[index] = (whole[index] ?? 0) + 1;
    spare -= 1;
  }
  return whole.map((width, index) => fixed[index] || width);
}
