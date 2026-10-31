'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const pricing = require('../src/engine.cjs');
const legacy = require('./fixtures/legacy-v1.cjs');
const fixtureManifest = require('./fixtures/legacy-v1-manifest.json');
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
};
const { apiVersion, version, ...pricingFields } = pricing.config;
const pricingFingerprint = createHash('sha256').update(JSON.stringify(canonical(pricingFields))).digest('hex');
// A label-only version bump cannot hide a changed algorithm under unchanged v1 fees.
const skip = version !== 'v1' && pricingFingerprint !== fixtureManifest.pricingConfigSha256;
const v1 = (name, fn) => test(`[v1] ${name}`, { skip }, fn);
const bands = legacy.artist.BASE_BANDS;
const shapes = Object.keys(legacy.artist.RATE.shape);
const whitespaceOptions = Object.keys(legacy.artist.RATE.whitespace);
const complexityOptions = Object.keys(legacy.artist.RATE.complexity);
const colorOptions = Object.keys(legacy.artist.RATE.color);

v1('2,700 artist conditions exactly match frozen original fields and floating-point values', () => {
  let count = 0;
  for (const band of bands) {
    for (const shape of shapes) {
      const short = Math.max(1, Math.floor(band.max * legacy.customer.SHAPE_RATIO[shape]));
      assert.equal(legacy.artist.shapeFromRatio(short / band.max), shape);
      for (const whitespace of whitespaceOptions) {
        for (const complexity of complexityOptions) {
          for (const color of colorOptions) {
            const input = { long: band.max, short, whitespace, complexity, color };
            assert.deepEqual(pricing.calculate(input, 'artist'), legacy.artist.calculate(input), JSON.stringify(input));
            count += 1;
          }
        }
      }
    }
  }
  assert.equal(count, 2700);
});

v1('every integer dimension pair in 1–300 mm preserves artist and customer results', () => {
  let cases = 0;
  for (let long = 1; long <= 300; long += 1) {
    for (let short = 1; short <= 300; short += 1) {
      const input = {
        long, short,
        whitespace: whitespaceOptions[(long + short) % whitespaceOptions.length],
        complexity: complexityOptions[(long * 3 + short) % complexityOptions.length],
        color: colorOptions[(long + short * 3) % colorOptions.length]
      };
      assert.deepEqual(pricing.calculate(input, 'artist'), legacy.artist.calculate(input), `${long}x${short} artist`);
      const expectedCustomer = legacy.customer.calculate(input);
      const actualCustomer = pricing.calculate(input, 'customer');
      if (!expectedCustomer) assert.equal(actualCustomer, null, `${long}x${short} customer invalid`);
      else {
        assert.equal(actualCustomer.raw, expectedCustomer.raw, `${long}x${short} raw`);
        assert.equal(actualCustomer.rounded, expectedCustomer.rounded, `${long}x${short} rounded`);
        assert.equal(actualCustomer.shape, expectedCustomer.shape, `${long}x${short} shape`);
      }
      cases += 1;
    }
  }
  assert.equal(cases, 90000);
});

v1('base transitions, special sizes, ratio thresholds, and zero-rate XXS remain exact', () => {
  for (let mm = 1; mm <= 300; mm++) assert.deepEqual(pricing.base(mm), legacy.artist.base(mm));
  for (const band of bands) {
    for (const mm of [band.min - 1, band.min, band.min + 1, band.max - 1, band.max, band.max + 1]) {
      assert.deepEqual(pricing.base(mm), legacy.artist.base(mm));
    }
  }
  for (const threshold of [0.34, 0.60, 0.85]) {
    for (const ratio of [threshold - Number.EPSILON, threshold, threshold + Number.EPSILON]) {
      assert.equal(pricing.shapeFromRatio(ratio), legacy.artist.shapeFromRatio(ratio));
    }
  }
  for (const ratio of [0, 1 / 3, 0.35, 0.61, 0.86, 1, NaN]) {
    assert.equal(pricing.shapeFromRatio(ratio), legacy.artist.shapeFromRatio(ratio));
  }
  for (const [type, options] of Object.entries(legacy.artist.RATE)) {
    for (const value of ['', ...Object.keys(options)]) {
      for (const size of ['XXS', 'XS', 'S', 'M', 'L', 'unknown']) {
        assert.equal(pricing.rate(type, value, size), legacy.artist.rate(type, value, size));
      }
    }
  }
  assert.equal(pricing.calculate({ long: 9, short: 9, whitespace: 'large', complexity: 'veryComplex', color: 'sevenPlus' }).rounded, 13000);
});

v1('artist blank selections retain zero rates; customer requires its selections', () => {
  let count = 0;
  for (const band of bands) {
    for (const shape of shapes) {
      for (const whitespace of ['', ...whitespaceOptions]) {
        for (const complexity of ['', ...complexityOptions]) {
          for (const color of ['', ...colorOptions]) {
            if (whitespace && complexity && color) continue;
            const input = {
              long: band.max,
              short: Math.max(1, Math.floor(band.max * legacy.customer.SHAPE_RATIO[shape])),
              whitespace, complexity, color
            };
            assert.deepEqual(pricing.calculate(input), legacy.artist.calculate(input));
            if (!complexity || !color) assert.equal(pricing.calculate(input, 'customer'), null);
            count += 1;
          }
        }
      }
    }
  }
  assert.equal(count, 2484);
});

v1('customer explicit-shape prices agree for all 13,800 integer length/option combinations', () => {
  let count = 0;
  for (const shape of shapes) {
    for (const complexity of complexityOptions) {
      for (const color of colorOptions) {
        const options = { shape, complexity, color };
        for (let long = 1; long <= 230; long += 1) {
          assert.equal(pricing.calculate({ long, ...options }, 'customer').rounded, legacy.customer.budgetPrice(long, options));
          count += 1;
        }
      }
    }
  }
  assert.equal(count, 13800);
});

v1('all 6,240 customer budget-slider combinations preserve largest affordable size', () => {
  let count = 0;
  for (const shape of shapes) {
    for (const complexity of complexityOptions) {
      for (const color of colorOptions) {
        const options = { shape, complexity, color };
        for (let budget = 17000; budget <= 120000; budget += 1000) {
          assert.equal(pricing.maxAffordableLength(budget, options), legacy.customer.maxAffordableLength(budget, options), `${budget} ${JSON.stringify(options)}`);
          count += 1;
        }
        for (const budget of [0, 12999, 13000, 16999, 120001, 1000000]) {
          assert.equal(pricing.maxAffordableLength(budget, options), legacy.customer.maxAffordableLength(budget, options));
        }
      }
    }
  }
  assert.equal(count, 6240);
});

v1('summary equivalence includes invalid, combined, first-piece, and one-time discount cases', () => {
  const first = legacy.artist.calculate({ long: 9, short: 9 });
  const second = legacy.artist.calculate({ long: 90, short: 50, complexity: 'veryComplex', color: 'sevenPlus' });
  const possibilities = [
    { calc: first, combined: false }, { calc: second, combined: true },
    { calc: null, combined: false }, { calc: null, combined: true }
  ];
  let count = 0;
  function visit(entries, remaining) {
    assert.deepEqual(pricing.summarize(entries), legacy.summarize(entries));
    count += 1;
    if (!remaining) return;
    for (const entry of possibilities) visit([...entries, entry], remaining - 1);
  }
  visit([], 5);
  assert.equal(count, 1365);
  const triple = pricing.summarize([{ calc: first }, { calc: first }, { calc: first }]);
  assert.equal(triple.discount, 5000);
  assert.equal(triple.total, 34000);
  assert.equal(pricing.summarize([{ calc: first }, { calc: null, combined: true }]).complete, true);
  assert.equal(pricing.summarize([{ calc: first }, { calc: null }]).complete, false);
});
