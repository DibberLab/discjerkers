'use strict';

const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../public/js/player.js');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('the ghost: every kind of throw, either hand, has sane joints all the way through, and the bones keep their length', async () => {
  const P = await load();
  for (const kind of ['backhand', 'forehand', 'putt']) {
    for (const hand of ['right', 'left']) {
      for (let ms = -200; ms <= P.LEAD[kind] + P.FOLLOW + 200; ms += 15) {
        const { joints: j } = P.poseAt(kind, ms, hand);
        for (const [name, p] of Object.entries(j)) assert.ok(p.every(Number.isFinite), `${kind} ${hand} ${ms} ${name}`);
        assert.ok(Math.abs(dist(j.rsho, j.relb) - 1.05) < 0.01 && Math.abs(dist(j.lsho, j.lelb) - 1.05) < 0.01, `${kind}: the upper arms stay the same length`);
        assert.ok(Math.abs(dist(j.rhip, j.rknee) - 1.62) < 0.01 && Math.abs(dist(j.lhip, j.lknee) - 1.62) < 0.01, `${kind}: and so do the thighs`);
        assert.ok(j.lfoot[2] >= -0.01 && j.rfoot[2] >= -0.01 && j.lfoot[2] < 1 && j.rfoot[2] < 1, `${kind}: the feet are on the ground, near enough`);
        assert.ok(j.head[2] > 4.5 && j.head[2] < 6.5, `${kind}: head at a person's height: ${j.head[2]}`);
      }
    }
  }
});

test('the ghost lets go of the disc where a thrower does: about four feet up for a drive, lower for a putt, out in front and to the throwing side', async () => {
  const P = await load();
  const bh = P.releasePoint('backhand', 'right');
  assert.ok(bh[2] > 3.7 && bh[2] < 4.3, `a backhand lets go at about 4 ft: ${bh[2]}`);
  assert.ok(bh[1] > 1.5 && bh[0] > 0.5, 'out in front and to the right');
  const fh = P.releasePoint('forehand', 'right');
  assert.ok(fh[2] > 3.2 && fh[2] < 4.1 && fh[1] > 1.5);
  const pt = P.releasePoint('putt', 'right');
  assert.ok(pt[2] > 2.9 && pt[2] < 3.5, `a putt a bit lower: ${pt[2]}`);
  const lh = P.releasePoint('backhand', 'left');
  assert.ok(Math.abs(lh[0] + bh[0]) < 1e-6 && Math.abs(lh[1] - bh[1]) < 1e-6 && Math.abs(lh[2] - bh[2]) < 1e-6, 'a left-hander is the mirror image');
  // the disc is in the hand until it is let go, and the throwing hand really is at the release then
  for (const kind of ['backhand', 'forehand', 'putt']) {
    assert.strictEqual(P.poseAt(kind, P.LEAD[kind] - 1).held, true);
    assert.strictEqual(P.poseAt(kind, P.LEAD[kind]).held, false);
    assert.strictEqual(P.poseAt(kind, -50).held, true, 'ready: holding it');
  }
  assert.strictEqual(P.poseAt('backhand', 100, 'right').grip, 'rhand');
  assert.strictEqual(P.poseAt('backhand', 100, 'left').grip, 'lhand');
});

test('the ghost moves: the arm goes back and then through, and the kind of throw is picked from the style', async () => {
  const P = await load();
  const y = (kind, ms) => P.poseAt(kind, ms).joints.rhand[1];
  assert.ok(y('backhand', 0.48 * P.LEAD.backhand) < y('backhand', 0) - 1, 'the backhand reaches back');
  assert.ok(y('backhand', P.LEAD.backhand) > y('backhand', 0) + 1.5, 'and comes through to the front');
  assert.ok(y('forehand', 0.5 * P.LEAD.forehand) < y('forehand', 0) - 0.5, 'the forehand cocks back');
  assert.ok(y('putt', P.LEAD.putt) > y('putt', 0.55 * P.LEAD.putt) + 0.8, 'a putt is a push');
  assert.strictEqual(P.kindFor(true, 'backhand'), 'putt');
  assert.strictEqual(P.kindFor(false, 'forehand'), 'forehand');
  assert.strictEqual(P.kindFor(false, 'backhand'), 'backhand');
  assert.ok(P.poseAt('backhand', 99999).joints.head.every(Number.isFinite), 'long after: the follow-through holds');
});
