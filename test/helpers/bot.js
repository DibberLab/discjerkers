'use strict';

// A careful player with a clean meter, for tests: it plays a hole around the route, trying many aims, discs and arm speeds and taking
// whichever lands nearest the basket (or the route's end), and counts strokes. Inside putting range a centred tap goes in.
const assert = require('node:assert');

const DRIVER = { id: 1, speed: 12, glide: 5, turn: -1, fade: 3 };
const FW = { id: 2, speed: 9, glide: 5, turn: -2, fade: 2 };
const MID = { id: 3, speed: 5, glide: 4, turn: 0, fade: 3 };
const PUT = { id: 4, speed: 3, glide: 3, turn: 0, fade: 1 };
const RIGHT = { hand: 'right', style: 'backhand', mph: 62, spin: null, angle: 0 };
const CLEAN = { o: 0, pure: false, sloppy: 0, grade: 'Good' };

function play(G, hole, grain) {
  let lie = { ...hole.tee };
  let strokes = 0;
  for (let n = 0; n < 9 && strokes < 99; n++) {
    if (G.distance(lie, hole.basket) <= G.PUTT_RANGE) { strokes += 1; break; } // a centered tap goes in
    const left = G.routeLeft(hole, lie.x, lie.y);
    const discs = left > 280 ? [DRIVER, FW] : left > 160 ? [FW, MID, DRIVER] : [MID, PUT, FW];
    // the woods are solid, so a careful player plays down the hole: aims along the route, at points further on, and at the basket
    const aims = new Set([Math.round(G.headingTo(lie, hole.basket))]);
    for (const look of [50, 90, 140, 200, 300]) {
      const h = G.headingTo(lie, G.routeAhead(hole, lie.x, lie.y, look));
      for (const off of [-9, -4.5, 0, 4.5, 9]) aims.add(Math.round(h + off));
    }
    let best = null;
    const tryAims = (list) => {
      for (const disc of discs) {
        for (const aim of list) {
          for (const angle of [-2, 0, 2]) {
            for (let mph = 12; mph <= 86; mph += grain) {
              const r = G.resolveThrow(hole, disc, { ...RIGHT, mph, angle }, aim, CLEAN, lie);
              if (r.kind !== 'landed' && r.kind !== 'basket') continue;
              const d = r.kind === 'basket' ? 0 : G.distance(r.lie, hole.basket) <= G.PUTT_RANGE ? G.distance(r.lie, hole.basket) : G.routeLeft(hole, r.lie.x, r.lie.y) + 60;
              if (!best || d < best.d) best = { d, r };
            }
          }
        }
      }
    };
    tryAims(aims);
    if (!best) tryAims(Array.from({ length: 60 }, (_, i) => i * 6)); // boxed in on the line of the hole: look every way
    assert.ok(best, `hole ${hole.id} (${hole.name}): there is always a way to play on`);
    strokes += 1;
    if (best.r.kind === 'basket') break;
    lie = best.r.lie;
  }
  return strokes;
}

// the fewest strokes over a few grains of arm speed (the bar is continuous, and a greedy search can be unlucky at one step size)
function par(G, hole, grains = [8, 4, 6, 3, 5]) {
  let best = Infinity;
  for (const g of grains) {
    best = Math.min(best, play(G, hole, g));
    if (best <= hole.par) break;
  }
  return best;
}

module.exports = { play, par, DRIVER, FW, MID, PUT, RIGHT, CLEAN };
