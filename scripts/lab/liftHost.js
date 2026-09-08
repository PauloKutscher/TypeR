/*
 * liftHost.js — run the host's own partition geometry in Node.
 *
 * The host is ExtendScript and cannot be required, so the pure functions are
 * lifted out of a given `app_src/host.js` text and rebuilt with their
 * dependencies injected. Lifting rather than reimplementing is the point: a
 * lab copy of the solver would drift from the shipped one, and every number
 * measured with it would be about the copy.
 *
 * The same source text can come from the working tree or from `git show
 * <rev>:app_src/host.js`, which is how a candidate is A/B'd against HEAD
 * without either build being installed.
 */

const assert = require("assert");

function liftFrom(source, overrides) {
  overrides = overrides || {};
  function lift(signature, deps) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp("function " + escaped + " \\{([\\s\\S]*?)\\r?\\n\\}"));
    assert.ok(match, signature + " must exist in the host source");
    const name = signature.slice(0, signature.indexOf("("));
    return new Function(...deps, `return function ${name}${signature.slice(signature.indexOf("("))} {${match[1]}\n};`);
  }

  /* The same function under whichever signature this revision gave it. */
  function liftAny(signatures, deps) {
    for (const signature of signatures) {
      const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp("function " + escaped + " \\{").test(source)) return lift(signature, deps);
    }
    assert.fail("none of " + signatures.join(" / ") + " exists in the host source");
  }

  // A constant an older revision never had comes back undefined rather than
  // throwing: the same lift then works for the engine that produced an archived
  // run and for the candidate being compared against it.
  function tuning(name) {
    const match = source.match(new RegExp(name + " = ([\\d.]+)"));
    return match ? Number(match[1]) : undefined;
  }

  const T = {};
  for (const name of [
    "_CUSP_CONCAVITY", "_CUSP_ASSIST_CONCAVITY", "_CUSP_SHARE_WAIST", "_CUSP_MAX_NECK",
    "_CUSP_MIN_PIECE_SHARE", "_CUSP_MAX_CUTS", "_CUSP_CONTOUR_POINTS", "_CUSP_SPAN_DIVISOR", "_CUSP_MIN_GAP",
    "_CUSP_MAX_PAIR_TRIES",
  ]) T[name] = tuning(name);

  const pointInPolygon = lift("_pointInPolygon(x, y, poly)", [])();
  const polygonCentroid = lift("_polygonCentroid(polygons)", ["_pointInPolygon"])(pointInPolygon);
  const signedArea = lift("_polygonSignedArea(poly)", [])();
  const areaCentroid = lift("_polygonAreaCentroid(poly)", [])();
  const largestContour = lift("_largestContour(polygons)", ["_polygonSignedArea"])(signedArea);
  const realResample = lift("_resampleContour(poly, count)", [])();
  /*
   * A caller replaying an archived run has to be able to say "this polygon is
   * already the engine's sample set, hand it back". Resampling it a second time
   * is not a no-op: the samples are uniform along the *original* outline, so
   * their own chords are shorter wherever the outline turned, and a second pass
   * measures the shorter perimeter and slides every sample. Measured on a real
   * region, up to 25 px of arc — enough to move which sample is a corner.
   */
  const resampleContour = overrides.resample ? overrides.resample(realResample) : realResample;
  const centreInsideOutline = lift("_centreInsideOutline(polygons, point)", ["_pointInPolygon"])(pointInPolygon);
  const splitContourAtChord = lift("_splitContourAtChord(points, a, b)", [])();
  const pieceOnSideOf = lift("_pieceOnSideOf(pieces, a, b, x, y)", [
    "_polygonSignedArea", "_polygonAreaCentroid", "_pointInPolygon",
  ])(signedArea, areaCentroid, pointInPolygon);
  const findCuspPair = liftAny(["_findCuspPair(points, skip)", "_findCuspPair(points)"], [
    "_CUSP_SPAN_DIVISOR", "_CUSP_MIN_GAP", "_CUSP_CONCAVITY", "_CUSP_ASSIST_CONCAVITY",
    "_CUSP_MAX_NECK", "_polygonSignedArea", "_polygonAreaCentroid", "_splitContourAtChord",
    "_pointInPolygon",
  ])(T._CUSP_SPAN_DIVISOR, T._CUSP_MIN_GAP, T._CUSP_CONCAVITY, T._CUSP_ASSIST_CONCAVITY,
    T._CUSP_MAX_NECK, signedArea, areaCentroid, splitContourAtChord, pointInPolygon);
  const splitAtCusps = lift("_splitOutlineAtCusps(polygons, activeBox, report)", [
    "_CUSP_CONCAVITY", "_CUSP_MIN_PIECE_SHARE", "_CUSP_MAX_CUTS", "_CUSP_CONTOUR_POINTS",
    "_CUSP_SPAN_DIVISOR", "_largestContour", "_resampleContour", "_findCuspPair", "_splitContourAtChord",
    "_pieceOnSideOf", "_polygonAreaCentroid", "_polygonSignedArea", "_CUSP_SHARE_WAIST",
    "_pointInPolygon", "_centreInsideOutline", "_CUSP_MAX_PAIR_TRIES",
  ])(T._CUSP_CONCAVITY, T._CUSP_MIN_PIECE_SHARE, T._CUSP_MAX_CUTS, T._CUSP_CONTOUR_POINTS,
    T._CUSP_SPAN_DIVISOR, largestContour, resampleContour, findCuspPair, splitContourAtChord,
    pieceOnSideOf, areaCentroid, signedArea, T._CUSP_SHARE_WAIST, pointInPolygon, centreInsideOutline,
    T._CUSP_MAX_PAIR_TRIES);

  return {
    tuning: T,
    realResample,
    pointInPolygon,
    polygonCentroid,
    signedArea,
    areaCentroid,
    largestContour,
    resampleContour,
    centreInsideOutline,
    splitContourAtChord,
    pieceOnSideOf,
    findCuspPair,
    splitAtCusps,
  };
}

module.exports = { liftFrom };
