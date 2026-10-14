/* Marebear's commentary. She watches every throw and has opinions. This is the game talking, not a chat: lines are picked
   from what just happened (a shank, a splash, a hole in one) and who it happened to. Pure functions: the caller supplies
   the dice, so a test can see every line come out. Keep it cheeky, never cruel, and never about a real person. */

// {name} is whoever it happened to; {disc} is the disc; {n} is a number (feet or strokes)
const MINE = {
  grip: ['The disc stuck to your fingers like it did not want to go either.', 'That was a grip lock. The disc held on for dear life, and honestly I get it.', 'You are supposed to let go of the disc. That is the whole sport.', 'Grip lock. Next time try opening your hand.'],
  early: ['Early release. The disc left before you did.', 'You let go of that like it was hot. It was not.', 'Early release. The disc was in a hurry to get away from you.', 'That one slipped out. Maybe your arm needs a minute.'],
  shank: ['That was not a throw, that was a cry for help.', 'A shank! I have seen leaves with better aim.', 'Bold choice, letting go at that exact moment.', 'The disc did what it could with what you gave it.'],
  tree: ['Thunk. The tree did not even move.', 'That tree has been there for eighty years. You have been here for two minutes.', 'You and that tree are going to be great friends.', 'The tree says thanks for stopping by.', 'Trees do not move. I keep telling people.'],
  mando: ['You missed the mando. The big red post. With the arrow on it.', 'That was the wrong side of the post, sweetheart. They put an arrow on it for you.', 'A mando is a rule, not a suggestion. One stroke, and do it again.'],
  water: ['Splash! The fish are thrilled.', 'You threw a perfectly good disc into a pond. I will remember this.', 'That disc is now a pond decoration.', 'The water was thirsty. Now it has a disc.', 'Did you think it could swim? It cannot.'],
  oob: ['Out of bounds. The boundary was right there. It was dashed. It was orange.', 'You found the part of the course where discs go to be forgotten.', 'Nobody told you there was an edge? There is an edge.'],
  rough: ['Rough. Like your day.', 'That is what the fairway looked like from far away.', 'The rough thanks you for visiting.'],
  rim: ['Rimmed out! So close, so useless.', 'The basket spat you out. It has standards.', 'Almost counts in horseshoes. This is not horseshoes.', 'That putt had its chance and said no thank you.'],
  soft: ['You babied that one. It never had a chance of getting there.', 'That swipe had all the conviction of a handshake from a ghost.', 'Short. You swiped like you were wiping a window.'],
  hard: ['You swiped that like it owed you money.', 'Way too hard. It is not a hockey puck.', 'You hammered it. The basket does not need to be impressed.'],
  wide: ['Your swipe pointed at a different basket entirely.', 'Off line. The basket was right there. It is orange.', 'That swipe had a mind of its own, and it was wrong.'],
  nasty: ['That putt took a nasty roll and kept going. I felt that one.', 'It rolled off like it had somewhere better to be.', 'A nasty roll. Gravity has opinions about you.', 'It ran and ran. You can walk it down, I guess.'],
  longMiss: ['Past thirty feet the target is a pinprick. What did you expect?', 'A putt that long? Optimism is lovely, but it is not a skill.', 'You missed a thirty-footer. Join the club. It is large.'],
  pure: ['Fine. That was good. Do not let it go to your head.', 'A pure throw. Savor it, there will not be many.', 'Okay, okay, show-off.'],
  ace: ['A hole in one?! I am going to pretend I did not see that.', 'An ace. Nobody will believe you.', 'Hole in one. The disc golf gods are clearly confused.'],
  chains: ['Chains! Do not get used to it.', 'In from out there? Fine. I will be here when it stops working.'],
  sunk: ['You made a long one. Enjoy it, I am sure you are not going to repeat it.', 'Chains from way out. Even a broken clock.'],
};
const THEIRS = {
  grip: ['{name} got a grip lock. The disc simply refused.', '{name} could not let go of the disc. We have all been there.'],
  early: ['{name} released early. The disc left without them.', '{name} let go too soon, and the disc said goodbye.'],
  shank: ['{name} shanked it. Please clap, but quietly.', 'That is a shank from {name}. A glorious one.'],
  tree: ['{name} found a tree. They are old friends now.', 'Thunk. {name} lost to a tree.', '{name} hit a tree. The tree won.'],
  mando: ['{name} missed the mando. There was a sign.', '{name} went the wrong side of the post. Rules are rules.'],
  water: ['{name} threw a disc into the water. A moment of silence.', 'Splash. {name} is feeding the fish.', '{name} went for a swim. The disc, not {name}.'],
  oob: ['{name} went out of bounds. The boundary is orange, {name}.', '{name} found out where the course ends.'],
  rim: ['{name} rimmed out. The basket said no.', '{name} was one inch from glory and could not be bothered.'],
  soft: ['{name} babied that putt and it died short.'],
  hard: ['{name} swiped that one way too hard.'],
  wide: ['{name} putted it somewhere near the basket, and not near enough.'],
  nasty: ['{name} putted it and it rolled off into the next county.', '{name} took a nasty roll. Somebody fetch it.'],
  longMiss: ['{name} missed a long putt. Tough, but honestly, expected.'],
  pure: ['{name} threw a pure one. I suppose that is allowed.', 'Nice throw from {name}. Do not tell them I said so.'],
  ace: ['{name} just aced it. I want to see the footage.', 'A hole in one for {name}. Somebody check the basket for cheating.'],
  chains: ['{name} holed out. Show-off.'],
  sunk: ['{name} drained a long one. Luck, obviously.'],
  rough: ['{name} is in the rough. A fine place to be, for them.'],
};
const HOLE = {
  ace: ['An ace! I have no notes.', 'A hole in one. I am not going to say anything. I am simply going to stare.'],
  eagle: ['An eagle! Who let you in?', 'Eagle. That was either very good or very lucky, and I am not asking which.'],
  birdie: ['A birdie. Fine. Do not make it a habit.', 'Birdie! I will allow it.'],
  par: ['Par. Perfectly average. Enjoy your trophy for showing up.', 'Par. Nobody is going to write a song about it, but well done.'],
  bogey: ['Bogey. The hole won, but only a little.', 'A bogey. It is not a crime. It is, however, a bogey.'],
  double: ['Double bogey! That is a lot of disc golf for one hole.', 'A double bogey. At least you got your steps in.'],
  triple: ['Triple bogey or worse. I would like to see the scorecard framed.', 'That hole took everything you had, and then some.', 'Okay, let us call that one a practice hole and never speak of it again.'],
  none: ['No discs left. They are all in my handbag, and I regret nothing.'],
};
const MATCH = {
  holeWin: ['You took that hole. {name} is looking at the ground.', 'You beat {name} on that one. Do you feel big? You should.'],
  holeLose: ['{name} took that hole off you. Their discs know the way and yours do not.', 'Lost that one to {name}. They are going to bring it up.'],
  holeShare: ['A shared hole. Everybody cringe a little.'],
  win: ['You won. I am as surprised as you are.', 'Winner! {name} will be telling people it was a fluke.'],
  lose: ['{name} wins. You were there, which counts for something.', 'You lost. I am sure it was the wind.', 'You came, you threw, you did not win.'],
  tie: ['A tie! The most boring result there is.'],
  left: ['You left. The discs are still out there, judging you.'],
};
// Marebear's bets: she bets against you, and you can take it or not. What each is worth is in BETS below.
export const BETS = {
  par: { text: 'make par or better', win: 3, lose: 2, offer: ['I bet you cannot make par on this one, sweetheart.', 'Par? You? On this hole? Put your bucks where your mouth is.', 'Three bucks says you do not make par. Go on.'] },
  bogey: { text: 'make bogey or better', win: 1, lose: 3, offer: ['I bet you cannot even make bogey. Easy money.', 'Bogey or better, honey? I am not so sure. Care to wager?', 'Bet you blow up on this one. Bogey or better, or you pay me.'] },
  birdie: { text: 'make birdie or better', win: 8, lose: 1, offer: ['A birdie? From you? Eight bucks says you can not. One buck says you wish you could.', 'Ha! Birdie or better and I will pay you handsomely. Not that I ever have to.'] },
};
const BETTING = {
  taken: ['Ooh, she is brave. I like that.', 'You are on, sweetheart. Do not cry when I take it.', 'Okay! Shake on it. I do not shake. Just throw.'],
  declined: ['Chicken. Bawk bawk.', 'Smart. Cowardly, but smart.', 'No bet? Fine. I will just laugh at you for free.'],
  won: ['Oh, you got me. I will not forget this. Here.', 'Fine, fine, take it. Beginner\'s luck.', 'You won the bet. I hate you a little. Here is your money.'],
  lost: ['Pay up, buttercup!', 'Hand it over, darling. A deal is a deal.', 'And that is how Marebear gets rich.'],
};
export const betOffer = (kind, rnd = Math.random, avoid = '') => pick(BETS[kind]?.offer || [], {}, rnd, avoid);
export const betRemark = (what, rnd = Math.random, avoid = '') => pick(BETTING[what], {}, rnd, avoid);
// which bet she offers on a hole of this par: a dare for a good player, an insult for a nervous one
export function betKind(par, rnd = Math.random) {
  const u = rnd();
  if (par === 3) return u < 0.5 ? 'par' : u < 0.8 ? 'bogey' : 'birdie';
  return u < 0.42 ? 'par' : u < 0.8 ? 'bogey' : 'birdie';
}
// did you win it? (the hole's strokes against its par)
export const betWon = (kind, strokes, par, holed = true) => holed && strokes <= par + (kind === 'bogey' ? 1 : kind === 'par' ? 0 : -1);

const BEAR = { mine: ['Do not look at me. You earned it.'], theirs: ['{name} is at a triple bogey. Marebear is reaching for her handbag.'] };

// Lines from public/data/heckles.json (the ones the owner wrote), by their own category names. They are in the second person,
// so when they are about somebody else's throw they are aimed at that player by name.
let CSV = {};
export function useHeckles(data) { CSV = data && typeof data === 'object' ? data : {}; }
const THROW_KEY = { tree: 'Hitting a Tree', water: 'Going in the Water', shank: 'Shanks', grip: 'Grip Locks', early: 'Early Releases', oob: 'Out of Bounds', rim: 'Rimmed Putts' };
const HOLE_KEY = { ace: 'Eagle', eagle: 'Eagle', birdie: 'Birdie', par: 'Par', bogey: 'Bogey', double: 'Double Bogey', triple: 'Double Bogey' };

const fill = (line, vars = {}) => line.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

// Pick a line from a list, not the one used last. `rnd` is a function returning 0..1.
export function pick(list, vars = {}, rnd = Math.random, avoid = '') {
  if (!list || !list.length) return '';
  const fresh = list.map((l) => fill(l, vars)).filter((l) => l !== avoid);
  const pool = fresh.length ? fresh : list.map((l) => fill(l, vars));
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}

/**
 * What was that throw? One of the keys above, or null when it was nothing to talk about.
 *   { kind, putt, made, gimme, ex, strokes (so far on the hole), dist (feet, for a putt), surface }
 */
export function eventFor({ kind, putt, made, gimme, ex, strokes, dist, surface, rim, nasty, why }) {
  if (putt) {
    if (made) return gimme ? null : dist > 30 ? 'sunk' : null;
    if (nasty) return 'nasty';
    if (why) return rim ? 'rim' : why === 'weak' ? 'soft' : why === 'strong' ? 'hard' : 'wide'; // a bad swipe: how it was bad
    if (rim) return 'rim';
    return dist > 30 ? 'longMiss' : 'rim';
  }
  if (ex?.slip === 'grip') return 'grip';
  if (ex?.slip === 'early') return 'early';
  if (kind === 'basket') return strokes === 1 ? 'ace' : 'chains';
  if (ex?.grade === 'Shank') return 'shank';
  if (kind === 'mando') return 'mando';
  if (kind === 'tree') return 'tree';
  if (kind === 'water') return 'water';
  if (kind === 'oob') return 'oob';
  if (ex?.pure) return 'pure';
  if (kind === 'landed' && surface === 'rough') return 'rough';
  return null;
}

// a remark on a throw: mine or somebody else's (`name` is theirs). Plain throws get nothing, and some of the rest get nothing too,
// so she stays funny instead of constant.
export function remark(event, { who = 'me', name = '' } = {}, rnd = Math.random, avoid = '') {
  if (!event) return { text: '', to: '' };
  const chance = { mando: 1, grip: 1, early: 1, shank: 1, tree: 0.85, water: 1, oob: 1, nasty: 1, soft: 1, hard: 1, wide: 1, rim: 0.7, longMiss: 0.8, pure: 0.5, ace: 1, chains: 0.8, sunk: 1, rough: 0.2 }[event] ?? 0.5;
  const own = CSV[THROW_KEY[event]];
  if (own && own.length) {
    if (rnd() > chance) return { text: '', to: '' };
    return { text: pick(own, {}, rnd, avoid), to: who === 'me' ? '' : name }; // "you" lines go to whoever threw
  }
  const list = (who === 'me' ? MINE : THEIRS)[event];
  if (!list) return { text: '', to: '' };
  if (rnd() > chance) return { text: '', to: '' };
  return { text: pick(list, { name }, rnd, avoid), to: '' };
}

// a hole finished: how it went (`score` is strokes, or the score a hole you could not finish counts as)
export function holeRemark(strokes, par, holed, rnd = Math.random, avoid = '') {
  if (!holed) return pick(HOLE.none, {}, rnd, avoid);
  const d = strokes - par;
  const key = strokes === 1 ? 'ace' : d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : d === 2 ? 'double' : 'triple';
  const own = CSV[HOLE_KEY[key]];
  return pick(own && own.length ? own : HOLE[key], {}, rnd, avoid);
}

// the others in a match: who took the hole, who won the day
export function matchRemark(kind, { name = '' } = {}, rnd = Math.random, avoid = '') {
  if (kind === 'lose' && CSV['Match Results']?.length) return pick(CSV['Match Results'], {}, rnd, avoid); // her words for the loser
  return pick(MATCH[kind], { name }, rnd, avoid);
}
export const bearRemark = (mine, name, rnd = Math.random) => pick(mine ? BEAR.mine : BEAR.theirs, { name }, rnd);

export const LINES = { MINE, THEIRS, HOLE, MATCH, BEAR, BETTING }; // for tests
