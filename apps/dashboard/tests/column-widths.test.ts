import { expect, it } from "vitest";
import {
  columnWidths,
  trimWidest,
  type ColumnSpec,
} from "../src/lib/column-widths";

const sum = (widths: number[]) => widths.reduce((a, b) => a + b, 0);
const data = (weight: number, floor = 0): ColumnSpec => ({
  fixed: 0,
  floor,
  weight,
});
const action = (fixed: number): ColumnSpec => ({ fixed, floor: 0, weight: 0 });
/** Deterministic pseudo-random numbers so a failure reproduces. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// @req R-DASH-21
it("shares the container by weight in whole pixels that sum exactly to its width", () => {
  expect(columnWidths([data(1), data(2), data(1)], 400)).toEqual([
    100, 200, 100,
  ]);
  // 1000 / 3 leaves one spare pixel; it goes to the column that lost the most to flooring.
  const thirds = columnWidths([data(1), data(1), data(1)], 1000);
  expect(sum(thirds)).toBe(1000);
  expect(thirds.every(Number.isInteger)).toBe(true);
  expect(sum(columnWidths([data(3), data(5), data(7)], 1150.7))).toBe(1150);
});

// @req R-DASH-21
it("keeps action columns at their pixels and pins data columns at their header floor", () => {
  // 344 px remain beside the action column; an 80 weight would get 86 px, under its floor.
  expect(columnWidths([data(240), action(56), data(80, 100)], 400)).toEqual([
    244, 56, 100,
  ]);
  // At 734 px an 80 weight would get 103 px; two 110 px floors pin and the rest reshares.
  const widths = columnWidths(
    [data(240, 58), data(170, 54), data(80, 110), data(80, 110)],
    734,
  );
  expect(widths).toEqual([301, 213, 110, 110]);
  expect(sum(widths)).toBe(734);
});

// @req R-DASH-21
it("scales the floors together when even they do not fit, never exceeding the container", () => {
  const widths = columnWidths([data(1, 100), data(1, 200), data(1, 300)], 300);
  expect(sum(widths)).toBe(300);
  expect(widths).toEqual([50, 100, 150]);
  expect(sum(columnWidths([data(1, 100), action(56)], 120))).toBe(120);
});

// @req R-DASH-21
it("never lets random weights, floors and action columns add up past the container", () => {
  const next = random(20260911);
  for (let round = 0; round < 500; round++) {
    const count = 1 + Math.floor(next() * 16);
    const specs = Array.from({ length: count }, () =>
      next() < 0.15
        ? action(40 + Math.floor(next() * 120))
        : data(20 + Math.floor(next() * 300), Math.floor(next() * 120)),
    );
    const container = 200 + next() * 1400;
    const widths = columnWidths(specs, container);
    const fixedTotal = specs.reduce((total, spec) => total + spec.fixed, 0);
    expect(widths).toHaveLength(count);
    expect(widths.every((width) => Number.isInteger(width) && width >= 0)).toBe(
      true,
    );
    // Data columns absorb the whole container; action columns alone keep their pixels.
    const hasData = specs.some((spec) => !spec.fixed);
    expect(sum(widths)).toBe(
      hasData && fixedTotal <= Math.floor(container)
        ? Math.floor(container)
        : fixedTotal,
    );
    specs.forEach((spec, index) => {
      if (spec.fixed) expect(widths[index]).toBe(spec.fixed);
    });
    const floorTotal = specs.reduce((total, spec) => total + spec.floor, 0);
    if (floorTotal < Math.floor(container) - fixedTotal)
      specs.forEach((spec, index) => {
        if (!spec.fixed)
          expect(widths[index]).toBeGreaterThanOrEqual(spec.floor);
      });
  }
});

// @req R-DASH-21
it("gives overflow back from the widest column that can spare it above its floor", () => {
  const specs = [data(240, 58), action(56), data(80, 100), data(170, 54)];
  const widths = columnWidths(specs, 600);
  expect(sum(widths)).toBe(600);
  const trimmed = trimWidest(widths, specs, 2);
  expect(sum(trimmed)).toBe(598);
  // The action column and the pinned column keep their pixels; the widest data column gives.
  expect(trimmed[1]).toBe(56);
  expect(trimmed[2]).toBe(widths[2]);
  expect(trimmed[0]).toBe((widths[0] ?? 0) - 2);
  // A column at its floor is skipped in favor of one with room; with none, the widest still gives.
  expect(trimWidest([100, 60], [data(1, 100), data(1, 50)], 5)).toEqual([
    100, 55,
  ]);
  expect(trimWidest([100, 60], [data(1, 100), data(1, 60)], 5)).toEqual([
    95, 60,
  ]);
  expect(trimWidest([56], [action(56)], 5)).toEqual([56]);
  expect(trimWidest([10, 20], [data(1), data(1)], 0)).toEqual([10, 20]);
});
