'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const pricing = require('../src/engine.cjs');
const root = path.resolve(__dirname, '..');
const config = pricing.config;
const options = {
  shape: Object.keys(pricing.RATE.shape)[0],
  complexity: Object.keys(pricing.RATE.complexity)[0],
  color: Object.keys(pricing.RATE.color)[0]
};
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
};

test('API contract: exports, config schema, and complete coverage of integer sizes', () => {
  assert.equal(pricing.apiVersion, 1);
  assert.match(pricing.version, /^v[1-9][0-9]*$/);
  assert.equal(pricing.version, config.version);
  for (const name of ['base', 'rate', 'shapeFromRatio', 'calculate', 'maxAffordableLength', 'summarize']) {
    assert.equal(typeof pricing[name], 'function', name);
  }
  assert.equal(pricing.BASE_BANDS, config.baseBands);
  assert.equal(pricing.RATE, config.rates);
  assert.equal(pricing.SHAPE_RATIO, config.shapeRatios);
  assert.ok(Number.isInteger(config.roundingUnit) && config.roundingUnit > 0);
  assert.ok(Number.isFinite(config.sameDayDiscount.amount) && config.sameDayDiscount.amount >= 0);
  assert.ok(Number.isInteger(config.sameDayDiscount.minSeparatelyPricedCount)
    && config.sameDayDiscount.minSeparatelyPricedCount >= 2);
  let previousMaximum = 0;
  for (const band of config.baseBands) {
    assert.equal(band.min, previousMaximum + 1, 'no gaps or overlaps');
    assert.ok(Number.isInteger(band.max) && band.max >= band.min);
    assert.ok(Number.isFinite(band.price) && band.price >= 0);
    for (let mm = band.min; mm <= band.max; mm++) assert.deepEqual(pricing.base(mm), band);
    previousMaximum = band.max;
  }
  assert.deepEqual(pricing.base(previousMaximum + 1), { special: true });
});

test('config and all nested tables are deeply frozen; returned base/calc objects are isolated', () => {
  function checkFrozen(value) {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.isFrozen(value), true);
    Object.values(value).forEach(checkFrozen);
  }
  checkFrozen(pricing);
  const first = config.baseBands[0];
  assert.throws(() => { first.price = 1; }, TypeError);
  const copy = pricing.base(first.min);
  copy.price = -1;
  assert.equal(pricing.base(first.min).price, first.price);
  const input = Object.freeze({ long: first.min, short: first.min, ...options });
  const calc = pricing.calculate(input);
  calc.rounded = -1;
  assert.notEqual(pricing.calculate(input).rounded, -1);
});

test('all versions: sequential floating-point operations and final rounding derive from config', () => {
  for (const band of config.baseBands) {
    for (const shape of Object.keys(config.rates.shape)) {
      for (const whitespace of ['', ...Object.keys(config.rates.whitespace)]) {
        for (const complexity of ['', ...Object.keys(config.rates.complexity)]) {
          for (const color of ['', ...Object.keys(config.rates.color)]) {
            const input = { long: band.max, shape, whitespace, complexity, color };
            const calc = pricing.calculate(input, 'artist');
            const afterShape = band.price * (1 + pricing.rate('shape', shape, band.size) / 100);
            const afterWhitespace = afterShape * (1 + pricing.rate('whitespace', whitespace, band.size) / 100);
            const afterComplexity = afterWhitespace * (1 + pricing.rate('complexity', complexity, band.size) / 100);
            const raw = afterComplexity * (1 + pricing.rate('color', color, band.size) / 100);
            assert.equal(calc.afterShape, afterShape);
            assert.equal(calc.afterWhitespace, afterWhitespace);
            assert.equal(calc.afterComplexity, afterComplexity);
            assert.equal(calc.raw, raw);
            assert.equal(calc.rounded, Math.max(0, Math.round(raw / config.roundingUnit) * config.roundingUnit));
            assert.equal(calc.shapeAmount, afterShape - band.price);
            assert.equal(calc.whitespaceAmount, afterWhitespace - afterShape);
            assert.equal(calc.complexityAmount, afterComplexity - afterWhitespace);
            assert.equal(calc.colorAmount, raw - afterComplexity);
          }
        }
      }
    }
  }
});

test('all versions: strict dimension and option validation with artist blank options preserved', () => {
  const maximum = config.baseBands.at(-1).max;
  const valid = { long: maximum, short: maximum, ...options };
  for (const input of [undefined, null, [], '', false, 7, {}, { shape: options.shape }]) {
    assert.equal(pricing.calculate(input), null);
  }
  for (const value of [undefined, null, '', '10', 0, -1, 1.5, NaN, Infinity, maximum + 1]) {
    assert.equal(pricing.calculate({ ...valid, long: value }), null, `long=${String(value)}`);
  }
  for (const value of ['', '1', 0, -1, 1.5, NaN, Infinity, maximum + 1]) {
    assert.equal(pricing.calculate({ ...valid, short: value }), null, `short=${String(value)}`);
  }
  assert.equal(pricing.calculate({ long: maximum }), null);
  assert.equal(pricing.calculate({ ...valid }, 'unknown'), null);
  assert.equal(pricing.calculate(valid, null), null);
  assert.equal(pricing.calculate({ ...valid, short: undefined, shape: 'unknown' }), null);
  for (const key of ['whitespace', 'complexity', 'color']) {
    for (const value of ['unknown', '__proto__', 'toString', 1, {}, []]) {
      assert.equal(pricing.calculate({ ...valid, [key]: value }), null);
    }
  }
  const artistBlank = pricing.calculate({ long: maximum, short: maximum });
  assert.ok(artistBlank);
  assert.equal(artistBlank.whitespace, '');
  assert.equal(artistBlank.complexity, '');
  assert.equal(artistBlank.color, '');
  assert.equal(artistBlank.whitespaceRate, 0);
  assert.equal(artistBlank.complexityRate, 0);
  assert.equal(artistBlank.colorRate, 0);
  assert.equal(pricing.calculate({ ...valid, complexity: '' }, 'customer'), null);
  assert.equal(pricing.calculate({ ...valid, color: '' }, 'customer'), null);
  const explicitShape = pricing.calculate({ long: maximum, ...options }, 'customer');
  assert.equal(explicitShape.short, null);
  assert.equal(explicitShape.shape, options.shape);
  const dimensionsWin = pricing.calculate({ ...valid, shape: 'ignored' });
  assert.equal(dimensionsWin.shape, pricing.shapeFromRatio(1));
});

test('all versions: customer calculation ignores every whitespace input', () => {
  for (const band of config.baseBands) {
    const input = { long: band.max, ...options };
    const expected = pricing.calculate(input, 'customer');
    for (const whitespace of ['', ...Object.keys(config.rates.whitespace), 'unknown', {}, null]) {
      assert.deepEqual(pricing.calculate({ ...input, whitespace }, 'customer'), expected);
    }
    assert.equal(expected.whitespaceRate, 0);
    assert.equal(expected.whitespaceAmount, 0);
    assert.equal(expected.afterWhitespace, expected.afterShape);
  }
});

test('all versions: rate lookup is total and zero-rate sizes override all selections', () => {
  for (const size of config.zeroRateSizes) {
    for (const [type, values] of Object.entries(config.rates)) {
      for (const value of Object.keys(values)) assert.equal(pricing.rate(type, value, size), 0);
    }
  }
  for (const unknown of ['', 'unknown', '__proto__', 'toString']) {
    assert.equal(pricing.rate(unknown, options.shape, 'XS'), 0);
    assert.equal(pricing.rate('shape', unknown, 'XS'), 0);
    assert.equal(pricing.rate('shape', options.shape, unknown), 0);
  }
});

test('all versions: budget search returns the largest qualifying dimension, including price decreases', () => {
  for (const shape of Object.keys(config.rates.shape)) {
    for (const complexity of Object.keys(config.rates.complexity)) {
      for (const color of Object.keys(config.rates.color)) {
        const choices = { shape, complexity, color };
        const maximum = config.baseBands.at(-1).max;
        const prices = Array.from({ length: maximum }, (_, index) => pricing.calculate({ long: index + 1, ...choices }, 'customer').rounded);
        const budgets = new Set([0, ...prices.flatMap(amount => [Math.max(0, amount - 1), amount, amount + 1])]);
        for (const budget of budgets) {
          const expected = prices.reduce((last, amount, index) => amount <= budget ? index + 1 : last, 0);
          assert.equal(pricing.maxAffordableLength(budget, choices), expected);
        }
      }
    }
  }
  for (const budget of [undefined, null, -1, NaN, Infinity, '30000']) {
    assert.equal(pricing.maxAffordableLength(budget, options), 0);
  }
  for (const choices of [undefined, null, {}, { ...options, complexity: '' }, { ...options, shape: '__proto__' }]) {
    assert.equal(pricing.maxAffordableLength(Number.MAX_SAFE_INTEGER, choices), 0);
  }
});

test('all versions: summary counts invalid separate pieces, ignores combined pieces, clamps totals', () => {
  const amount = config.baseBands[0].price;
  const calc = { rounded: amount };
  assert.deepEqual(pricing.summarize([]), { subtotal: 0, discount: 0, total: 0, complete: true, separatelyPricedCount: 0 });
  const firstCombined = pricing.summarize([{ calc, combined: true }]);
  assert.equal(firstCombined.subtotal, amount);
  assert.equal(firstCombined.separatelyPricedCount, 1);
  assert.equal(firstCombined.discount, 0);
  assert.equal(pricing.summarize([{ calc: null, combined: true }]).complete, false);
  const threshold = config.sameDayDiscount.minSeparatelyPricedCount;
  const entries = Array.from({ length: threshold }, () => ({ calc }));
  const expectedSubtotal = amount * threshold;
  const summary = pricing.summarize(entries);
  assert.deepEqual(summary, {
    subtotal: expectedSubtotal, discount: config.sameDayDiscount.amount,
    total: Math.max(0, expectedSubtotal - config.sameDayDiscount.amount), complete: true,
    separatelyPricedCount: threshold
  });
  assert.deepEqual(pricing.summarize([...entries, { calc: null, combined: true }]), summary);
  const incomplete = pricing.summarize([...entries, { calc: null }]);
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.separatelyPricedCount, threshold + 1);
  assert.equal(incomplete.discount, config.sameDayDiscount.amount);
  assert.equal(incomplete.subtotal, expectedSubtotal);
  assert.equal(pricing.summarize(entries.map(() => ({ calc: { rounded: 0 } }))).total, 0);
  for (const malformed of [{}, { rounded: NaN }, { rounded: Infinity }, { rounded: -1 }, { rounded: '1000' }]) {
    assert.equal(pricing.summarize([{ calc: malformed }]).complete, false);
  }
  assert.throws(() => pricing.summarize(null), TypeError);
});

test('UMD browser, CommonJS, and AMD bundles expose the same deterministic engine', () => {
  const bundlePath = path.join(root, 'dist/pricing.js');
  const manifestPath = path.join(root, 'dist/manifest.json');
  const beforeBundle = fs.readFileSync(bundlePath, 'utf8');
  const beforeManifest = fs.readFileSync(manifestPath, 'utf8');
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/build.cjs')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(bundlePath, 'utf8'), beforeBundle, 'committed bundle must match sources');
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), beforeManifest, 'manifest must be deterministic');
  const manifest = JSON.parse(beforeManifest);
  assert.equal(manifest.sha256, createHash('sha256').update(beforeBundle).digest('hex'));
  assert.equal(manifest.apiVersion, pricing.apiVersion);
  assert.equal(manifest.version, pricing.version);
  assert.equal(manifest.file, 'pricing.js');
  const browser = {};
  vm.runInNewContext(beforeBundle, browser);
  let amd;
  const define = (_dependencies, factory) => { amd = factory(); };
  define.amd = {};
  vm.runInNewContext(beforeBundle, { define });
  const cjs = require('../dist/pricing.js');
  const normalize = value => JSON.parse(JSON.stringify(value));
  for (const other of [browser.MeaPricing, amd, cjs]) {
    assert.deepEqual(normalize(other.config), config);
    assert.equal(other.apiVersion, pricing.apiVersion);
    for (const band of config.baseBands) {
      const input = { long: band.max, ...options };
      assert.deepEqual(normalize(other.calculate(input)), pricing.calculate(input));
    }
  }
});

test('v1 fingerprint gate: retain the frozen baseline for unchanged v1 pricing fields', () => {
  const legacy = require('./fixtures/legacy-v1-manifest.json');
  const { version, apiVersion, ...pricingFields } = config;
  const hash = createHash('sha256').update(JSON.stringify(canonical(pricingFields))).digest('hex');
  if (version === 'v1') assert.equal(hash, legacy.pricingConfigSha256, 'change pricing version before changing fees; never rewrite v1 oracle');
  // legacy-v1.test.cjs runs when either the label or the pricing fingerprint is v1.
  assert.match(legacy.pricingConfigSha256, /^[a-f0-9]{64}$/);
});
