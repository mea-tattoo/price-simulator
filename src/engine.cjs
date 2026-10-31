'use strict';

// This factory is the sole implementation used by both CommonJS and the browser build.
function createPricingEngine(sourceConfig) {
  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  const config = deepFreeze(JSON.parse(JSON.stringify(sourceConfig)));
  const BASE_BANDS = config.baseBands;
  const RATE = config.rates;
  const SHAPE_RATIO = config.shapeRatios;
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function base(mm) {
    const band = BASE_BANDS.find(item => mm >= item.min && mm <= item.max);
    return band ? { ...band } : { special: true };
  }

  function rate(type, value, size) {
    if (config.zeroRateSizes.includes(size)) return 0;
    if (!has(RATE, type) || !has(RATE[type], value)) return 0;
    return has(RATE[type][value], size) ? RATE[type][value][size] : 0;
  }

  function shapeFromRatio(ratio) {
    const threshold = config.shapeThresholds.find(item => ratio <= item.max);
    return threshold ? threshold.shape : config.fallbackShape;
  }

  function validOption(type, value, allowBlank) {
    return typeof value === 'string' && ((allowBlank && value === '') || has(RATE[type], value));
  }

  function calculate(input, profile = 'artist') {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    if (profile !== 'artist' && profile !== 'customer') return null;
    const long = input.long;
    if (!Number.isInteger(long) || long < 1) return null;
    const band = base(long);
    if (band.special) return null;

    const hasShort = input.short !== undefined && input.short !== null;
    const short = hasShort ? input.short : null;
    if (hasShort && (!Number.isInteger(short) || short < 1 || short > long)) return null;
    // Dimensions are authoritative; an explicit shape is used only when short is absent.
    const shape = hasShort ? shapeFromRatio(short / long) : input.shape;
    if (!validOption('shape', shape, false)) return null;
    const whitespace = profile === 'artist' ? (input.whitespace ?? '') : '';
    const complexity = input.complexity ?? '';
    const color = input.color ?? '';
    const allowBlank = profile === 'artist';
    if (!validOption('whitespace', whitespace, true)
      || !validOption('complexity', complexity, allowBlank)
      || !validOption('color', color, allowBlank)) return null;

    const shapeRate = rate('shape', shape, band.size);
    const whitespaceRate = profile === 'artist' ? rate('whitespace', whitespace, band.size) : 0;
    const complexityRate = rate('complexity', complexity, band.size);
    const colorRate = rate('color', color, band.size);
    // Preserve the original left-to-right floating-point operations. Do not combine
    // factors, round intermediate amounts, or substitute integer percentage math.
    const afterShape = band.price * (1 + shapeRate / 100);
    const afterWhitespace = afterShape * (1 + whitespaceRate / 100);
    const afterComplexity = afterWhitespace * (1 + complexityRate / 100);
    const raw = afterComplexity * (1 + colorRate / 100);
    const rounded = Math.max(0, Math.round(raw / config.roundingUnit) * config.roundingUnit);
    return {
      long, short, size: band.size, bandMin: band.min, bandMax: band.max, basePrice: band.price,
      shape, shapeRate, whitespace, whitespaceRate, complexity, complexityRate, color, colorRate,
      shapeAmount: afterShape - band.price,
      whitespaceAmount: afterWhitespace - afterShape,
      complexityAmount: afterComplexity - afterWhitespace,
      colorAmount: raw - afterComplexity,
      afterShape, afterWhitespace, afterComplexity, raw, rounded
    };
  }

  function maxAffordableLength(budget, options) {
    if (!Number.isFinite(budget) || budget < 0 || !options || typeof options !== 'object') return 0;
    let maximum = 0;
    const minimumLength = Math.min(...BASE_BANDS.map(band => band.min));
    const maximumLength = Math.max(...BASE_BANDS.map(band => band.max));
    for (let mm = minimumLength; mm <= maximumLength; mm += 1) {
      const calc = calculate({
        long: mm, shape: options.shape, complexity: options.complexity, color: options.color
      }, 'customer');
      if (calc && calc.rounded <= budget) maximum = mm;
    }
    return maximum;
  }

  function summarize(entries) {
    if (!Array.isArray(entries)) throw new TypeError('summarize expects an array');
    let subtotal = 0;
    let complete = true;
    let separatelyPricedCount = 0;
    entries.forEach((entry, index) => {
      if (index > 0 && entry?.combined) return;
      separatelyPricedCount += 1;
      const calc = entry?.calc;
      if (!calc || !Number.isFinite(calc.rounded) || calc.rounded < 0) complete = false;
      else subtotal += calc.rounded;
    });
    const discount = separatelyPricedCount >= config.sameDayDiscount.minSeparatelyPricedCount
      ? config.sameDayDiscount.amount : 0;
    return {
      subtotal, discount, total: Math.max(0, subtotal - discount), complete, separatelyPricedCount
    };
  }

  return Object.freeze({
    apiVersion: config.apiVersion, version: config.version,
    BASE_BANDS, RATE, SHAPE_RATIO, config,
    base, rate, shapeFromRatio, calculate, maxAffordableLength, summarize
  });
}

module.exports = createPricingEngine(require('../config.json'));
