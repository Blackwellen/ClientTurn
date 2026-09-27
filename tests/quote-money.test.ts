import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MINOR,
  MoneyError,
  allocate,
  allocateMatrix,
  assertMinor,
  extend,
  formatBps,
  formatMilli,
  formatMinor,
  mulDivFloor,
  mulDivRound,
  percentOf,
  ratioBps,
  toMilli,
} from "../src/lib/quotes/money.ts";
import { canonicalJson, hashCanonical } from "../src/lib/quotes/canonical.ts";

describe("integer rounding", () => {
  const cases: [number, number, number, number][] = [
    // a, b, d, round-half-up(a*b/d)
    [10, 500, 10_000, 1], // 0.5 -> 1 (REDUCED 5% of 10p)
    [30, 500, 10_000, 2], // 1.5 -> 2
    [29, 500, 10_000, 1], // 1.45 -> 1
    [3, 2000, 10_000, 1], // 0.6 -> 1
    [2, 2000, 10_000, 0], // 0.4 -> 0
    [4499, 2000, 10_000, 900], // 899.8 -> 900
    [1999, 500, 10_000, 100], // 99.95 -> 100
    [-10, 500, 10_000, -1], // half away from zero
    [-29, 500, 10_000, -1],
    [0, 2000, 10_000, 0],
  ];
  for (const [a, b, d, expected] of cases) {
    test(`mulDivRound(${a}, ${b}, ${d}) = ${expected}`, () => {
      assert.equal(mulDivRound(a, b, d), expected);
    });
  }

  test("large products go through BigInt without precision loss", () => {
    // 999,999,999,999 x 9,999 / 10,000 overflows 2^53 as a float product.
    assert.equal(mulDivRound(999_999_999_999, 9_999, 10_000), 999_899_999_999);
    assert.equal(mulDivFloor(999_999_999_999, 9_999, 10_000), 999_899_999_999);
  });

  test("percentOf and ratioBps", () => {
    assert.equal(percentOf(600000, 2500), 150000);
    assert.equal(percentOf(11400, 3333), 3800); // 3799.62
    assert.equal(ratioBps(1, 3), 3333);
    assert.equal(ratioBps(2, 3), 6667);
    assert.equal(ratioBps(-1, 3), -3333);
    assert.equal(ratioBps(5, 0), null);
  });

  test("assertMinor rejects floats and out-of-range values", () => {
    assert.throws(() => assertMinor(1.5), MoneyError);
    assert.throws(() => assertMinor(MAX_MINOR + 1), MoneyError);
    assert.equal(assertMinor(MAX_MINOR), MAX_MINOR);
  });
});

describe("quantities", () => {
  test("toMilli accepts up to three decimals and refuses finer", () => {
    assert.equal(toMilli(7.5), 7500);
    assert.equal(toMilli(0.333), 333);
    assert.equal(toMilli(1.001), 1001);
    assert.throws(() => toMilli(0.0005), MoneyError);
    assert.throws(() => toMilli(Number.NaN), MoneyError);
  });

  test("extend rounds unit x fractional quantity half up", () => {
    assert.equal(extend(9500, 333), 3164); // 3163.5
    assert.equal(extend(9500, 7500), 71250);
    assert.equal(extend(1, 500), 1); // 0.5 -> 1
    assert.equal(extend(1, 499), 0);
  });
});

describe("allocation", () => {
  test("largest remainder, ties to the lower index, sums exactly", () => {
    assert.deepEqual(allocate(45000, [500000, 95000]), [37815, 7185]);
    assert.deepEqual(allocate(8000, [4999, 75000]), [500, 7500]);
    assert.deepEqual(allocate(1, [1, 1]), [1, 0]);
    assert.deepEqual(allocate(2, [1, 1, 1]), [1, 1, 0]);
    assert.deepEqual(allocate(0, [0, 0]), [0, 0]);
    assert.deepEqual(allocate(10, [0, 5]), [0, 10]);
  });

  test("never allocates more than a weight when the total fits", () => {
    for (let total = 0; total <= 60; total += 1) {
      const weights = [7, 13, 1, 19, 20];
      const parts = allocate(total, weights);
      assert.equal(parts.reduce((a, b) => a + b, 0), total);
      parts.forEach((part, i) => assert.ok(part <= weights[i] && part >= 0));
    }
  });

  test("refuses a non-zero total over zero weights", () => {
    assert.throws(() => allocate(5, [0, 0]), MoneyError);
  });

  test("allocateMatrix reconciles rows and buckets with no negative cell", () => {
    const rows = [301675, 301674];
    const buckets = [600000, 2099, 1250];
    const matrix = allocateMatrix(rows, buckets);
    matrix.forEach((cells, r) => assert.equal(cells.reduce((a, b) => a + b, 0), rows[r]));
    buckets.forEach((total, b) => assert.equal(matrix.reduce((t, row) => t + row[b], 0), total));
    matrix.flat().forEach((cell) => assert.ok(cell >= 0));
  });

  test("allocateMatrix property: many random splits stay exact and non-negative", () => {
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let run = 0; run < 300; run += 1) {
      const buckets = Array.from({ length: 1 + rand(4) }, () => rand(5000));
      const total = buckets.reduce((a, b) => a + b, 0);
      const rowCount = 1 + rand(6);
      const rows: number[] = [];
      let left = total;
      for (let i = 0; i < rowCount - 1; i += 1) {
        const take = rand(left + 1);
        rows.push(take);
        left -= take;
      }
      rows.push(left);
      const matrix = allocateMatrix(rows, buckets);
      matrix.forEach((cells, r) => assert.equal(cells.reduce((a, b) => a + b, 0), rows[r]));
      buckets.forEach((t, b) => assert.equal(matrix.reduce((s, row) => s + row[b], 0), t));
      assert.ok(matrix.flat().every((cell) => cell >= 0));
    }
  });

  test("allocateMatrix refuses mismatched totals", () => {
    assert.throws(() => allocateMatrix([10], [11]), MoneyError);
  });
});

describe("formatting", () => {
  test("formatMinor is deterministic and grouped", () => {
    assert.equal(formatMinor(0, "GBP"), "£0.00");
    assert.equal(formatMinor(5, "GBP"), "£0.05");
    assert.equal(formatMinor(123456789, "GBP"), "£1,234,567.89");
    assert.equal(formatMinor(-1999, "EUR"), "-€19.99");
    assert.equal(formatMinor(1500, "JPY"), "1,500 JPY");
    assert.equal(formatMinor(1000, "CHF"), "10.00 CHF");
  });
  test("formatBps and formatMilli", () => {
    assert.equal(formatBps(2000), "20%");
    assert.equal(formatBps(1250), "12.5%");
    assert.equal(formatBps(3333), "33.33%");
    assert.equal(formatBps(5), "0.05%");
    assert.equal(formatMilli(7500), "7.5");
    assert.equal(formatMilli(1000), "1");
    assert.equal(formatMilli(333), "0.333");
  });
});

describe("canonical JSON", () => {
  test("key order does not change the hash; undefined is dropped", () => {
    assert.equal(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] }), '{"a":[1,{"c":3,"d":2}],"b":1}');
    assert.equal(hashCanonical({ a: 1, b: undefined }), hashCanonical({ a: 1 }));
    assert.notEqual(hashCanonical({ a: 1 }), hashCanonical({ a: 2 }));
  });
  test("refuses non-finite numbers", () => {
    assert.throws(() => canonicalJson({ a: Number.POSITIVE_INFINITY }));
  });
});
