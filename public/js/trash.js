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

// A good deal more of her, so a long round does not hear the same remark twice (she also remembers what she has said: see `pick`).
const MORE2_MINE = {
  grip: ['Your hand and that disc are in a committed relationship now.', 'Let go, darling. Nobody is going to take it from you. Except me.', 'You held on so long the disc started to feel like a hostage.', 'Open the fingers, honey. Open the fingers. That is the whole trick.', 'A grip lock. I have held onto things that long myself, but they were diamonds.', 'That disc stayed in your hand like a coupon at the end of the month.'],
  early: ['Gone before you were ready. I know the feeling, I was married three times.', 'That disc left like a guest who heard the check was coming.', 'Too early, sweetheart. Patience is a lipstick shade you have not tried yet.', 'You let go like you remembered the oven was on.', 'The disc left early. I do not blame it, honestly.', 'Premature, darling. Premature. We will leave it there.'],
  shank: ['Honey, I have seen better aim from a toddler with a spoon.', 'That was not a throw, that was a sneeze with a disc in it.', 'The disc went sideways and so did my opinion of you.', 'My hairdo has better direction than that, and it is held up by prayer.', 'A shank. Please do not do that near anything I love.', 'You threw that like you were swatting a wasp off your casserole.'],
  tree: ['The tree stepped out in front of you. Rude, but also very much your fault.', 'That tree was minding its business, sweetheart.', 'You and the woods: a love story with a bad ending.', 'Thwack! That tree has not felt this seen in years.', 'The disc and the tree have met. They did not hit it off.', 'Trees do not move, honey. I have told you. I have told the whole county.'],
  water: ['Sploosh. I hope that disc could swim, because it was not given lessons.', 'You gave the pond a gift. It will not write a thank-you card.', 'The fish have a new frisbee and they have you to thank.', 'Into the drink! Hand me one, I need it more than the disc did.', 'That water has been waiting all day for someone like you.', 'You threw it in the pond. The pond says thanks and that you owe it a disc.'],
  oob: ['Out of bounds, honey. The orange line is not a suggestion, it is a hobby.', 'You are off the map. I would send a search party, but I am between hobbies.', 'That disc has left the property. It is now a problem for somebody else. Yours.', 'The boundary is there for your protection, darling. And my amusement.', 'You threw it where discs go to retire.', 'A penalty stroke. The line is orange, it is dashed, and you went right through it.'],
  rough: ['The rough, darling. It is a lovely place, if you like weeds.', 'Rough lie. Rough day. Rough hair. A theme is forming.', 'You landed in the weeds. At least the weeds are happy to see you.', 'That is long grass, sweetheart. Bring a flashlight and a good attitude.', 'Not fairway. Not even close. But the grass is thrilled.', 'You are in the rough, and I am sorry, but I am also taking notes.'],
  rim: ['It hit the cage, it hesitated, it left. Like my second husband.', 'The basket said maybe, and then it said no.', 'A rim out. The cruelest part of the sport, and I have watched bingo.', 'So close the basket felt it. Not close enough to keep it.', 'That disc visited the basket and went home. Rude.', 'The chains looked at you and sighed. I felt that sigh.'],
  soft: ['That was a love tap. The basket wanted a kiss and got a handshake.', 'Too soft, darling. You putted like you were apologizing to it.', 'It died on the way. We should say a few words. Short ones.', 'You swiped that like you were buttering toast for someone you did not like.', 'Gentle! That disc could have used a pep talk.', 'The disc ran out of courage halfway there. So did you.'],
  hard: ['Way too hard, sweetheart. The basket is not a punching bag.', 'You swiped that like it had insulted my casserole.', 'Too much arm. The disc is trembling.', 'That putt left at a speed meant for emergencies.', 'Whoa, Nelly. It is a putt, not a getaway.', 'You hit that like you had a bus to catch.'],
  wide: ['That swipe was heading to a basket, just not this one.', 'Off line, honey. The line is the one thing that was free.', 'You aimed at a basket and the disc chose another one. Mutiny.', 'Left, right, wherever, as long as it is not toward the basket.', 'The disc and the basket are not on speaking terms after that.', 'You missed the line by a mile and the basket by two.'],
  nasty: ['That putt rolled off like it saw a sale somewhere else.', 'It rolled and rolled. I would have given it a ride.', 'A nasty roll. Even the grass could not stop it.', 'That disc has a mind of its own, and it is taking a road trip.', 'You will be walking to fetch that one. Good for your circulation.', 'Off it went, rolling away like a rumor.'],
  longMiss: ['A long one, honey. Nobody is judging you. Okay, I am judging you a little.', 'You did not make it from there. Neither would the Pope.', 'From that far, I give you credit for trying. Credit is all I give.', 'A long putt missing is not a tragedy, it is just Tuesday.', 'You tried a miracle. They are booked this week.', 'That was a long shot, and it behaved like a long shot.'],
  pure: ['Oh, that was pretty. Do not look at me, I am not clapping.', 'A beautiful throw. I am pretending to be unimpressed.', 'Look at you. Releasing like you mean it.', 'That was clean enough to eat off. Do not eat off the disc.', 'Textbook. If the textbook was written by someone who liked you.', 'You threw that perfectly, and I am furious about it.'],
  ace: ['A hole in one. I need a lie down and a glass of something.', 'An ace! I take back everything I said. Some of it.', 'That is not luck, that is witchcraft, and I want the recipe.', 'Hole in one, and not a person here will believe you. Not even me.', 'In one! I could kiss you. I will not, the lipstick is new.', 'I saw it with my own eyes and I am still filing a complaint.'],
  chains: ['In the chains! Listen to that sound. I will never admit I like it.', 'It went in. I will allow it, this once.', 'The basket took it. Do not look so pleased.', 'Chains! Even I did not see that coming, and I see everything.', 'Nice one. It will not last, but nice one.', 'In it goes. A round of applause, performed internally.'],
  sunk: ['You made it from way out there. Good grief. Somebody pinch me.', 'That was a long one and it went in. Fine. Marvelous. Whatever.', 'A long putt, in the chains. I need a minute with my compact.', 'From that distance? You are either gifted or guilty.', 'Drained it. I will be telling people it was my idea.', 'Long range, no problem. Show-off, darling. Show-off.'],
  mando: ['The mando is the red post, sweetheart. The post. The red one.', 'You went the wrong side of the mando. That is a stroke, and an eye roll.', 'A mando is a signpost with opinions. You ignored its opinions.', 'You cannot go that way. It said so. With an arrow.', 'One stroke for the mando, and one for being stubborn.', 'The post pointed. You went the other way. A bold, wrong choice.'],
};
const MORE2_THEIRS = {
  grip: ['{name} is still holding that disc, in spirit.', '{name} had a grip lock. Some people just cannot let go.', '{name} could not release it. A commitment problem, I would say.', 'Grip lock for {name}. I know that kind of clinginess.'],
  early: ['{name} let go early. The disc was not ready, and neither was {name}.', 'An early release from {name}. It happens to the best of us, apparently.', '{name} released too soon, and the disc hit the road.', 'Premature, {name}. That is all I will say.'],
  shank: ['{name} shanked it. I will light a candle for the disc.', 'A shank from {name}. The disc is filing for divorce.', '{name} threw that sideways on purpose, right? Right?', 'That was ugly, {name}. Gorgeous, but ugly.'],
  tree: ['{name} and the tree. It was always going to end like this.', 'The tree stopped {name}. The tree has a future in security.', '{name} hit the wood. I heard it from here.', 'Thwack! {name} found out that trees are solid.'],
  water: ['{name} threw it in the pond. The fish are applauding.', 'Sploosh. {name} is now a pond contributor.', '{name} found the water. Somebody get a towel for the disc.', 'The pond thanks {name} for the donation.'],
  oob: ['{name} is out of bounds. Somebody send a postcard.', '{name} threw it off the map. Bold.', 'Out of bounds for {name}. The orange line wins again.', '{name} left the course. The disc did, anyway.'],
  rim: ['{name} rimmed out. The basket looked away.', 'So close, {name}. So very, very close. Hee.', 'The disc kissed the basket and kept walking. Sorry, {name}.', '{name} got the rim and nothing else.'],
  soft: ['{name} putted like a library voice. The disc fell short.', 'Too gentle, {name}. The basket needs a firmer hand.', '{name} left it short. It did not have the energy.', 'Not enough oomph from {name}. It never arrived.'],
  hard: ['{name} putted that like it owed them money.', 'Easy, {name}. The basket did nothing to you.', '{name} swiped with a little too much feeling.', 'That was a lot of power from {name}, and nowhere to put it.'],
  wide: ['{name} swiped that wide. The basket is over there, honey.', 'Off line for {name}. The line is right there. It is the whole point.', '{name} missed the line and the basket in one move.', 'The disc went anywhere but the basket, thanks to {name}.'],
  nasty: ['{name} watched a putt roll off into the sunset.', 'The disc took off on {name}. It had plans.', 'A nasty roll for {name}. I felt it in my knees.', '{name} is going for a walk. The disc started it.'],
  longMiss: ['{name} missed a long one. Nobody is shocked.', 'A hopeful putt from {name}. Hope is not a technique.', '{name} tried a long one and the long one said no.', 'Long miss, {name}. A fine try. A terrible result.'],
  pure: ['{name} threw a good one. I am pretending I did not see it.', 'A pure throw from {name}. Fine. Lovely. Moving on.', '{name} released that perfectly. It made me feel unwell.', 'Pretty throw, {name}. Do not let it go to your head.'],
  ace: ['{name} aced it! I am going to need a fan.', 'An ace from {name}. Somebody check them for magnets.', '{name} got a hole in one. The rest of you can go home.', 'Hole in one for {name}. I am speechless, and that never happens.'],
  chains: ['{name} made it. It was probably an accident.', 'In the basket for {name}. Mark it down, then forget it.', '{name} holed out. Good for them. Truly. Mostly.', 'Chains for {name}. It makes a lovely sound. I will not say so twice.'],
  sunk: ['{name} sank a long one. Luck is a fickle lady, and she likes {name}.', 'A long putt in for {name}. I need to sit down.', '{name} drained it from way out. I hate that I enjoyed it.', 'From that far? {name}, you are making the rest of us look bad.'],
  rough: ['{name} landed in the rough. It suits them.', '{name} is in the weeds. I will send flowers.', 'Rough lie for {name}. The grass is thrilled.', '{name} found the long grass. It was waiting for them.'],
  mando: ['{name} missed the mando. Arrow, post, everything. Gone.', 'The mando got {name}. A stroke, and a lesson.', '{name} went the wrong way round the post. The post is hurt.', '{name} ignored the arrow. I am writing it up now.'],
};
const MORE2_HOLE = {
  ace: ['A hole in one! Hand me my smelling salts.', 'An ace. I do not trust it, I do not trust you, but I am happy.', 'One throw. One. I am going to need a drink and a wig adjustment.', 'An ace! The stuff of legend, and I was here for it.', 'Hole in one, honey. Do not tell people you did it. Tell them I made you.'],
  eagle: ['An eagle! I should have worn my good earrings.', 'Two under, sweetheart. Somebody write this down.', 'Eagle. You have my respect and my suspicion.', 'An eagle on a day like this? The universe is confused.', 'Eagle! You are on fire, and I would like to know who you paid.'],
  birdie: ['A birdie, honey. Look at you, behaving like a professional.', 'Birdie! Do not let it go to your head. It will not fit anyway.', 'One under. I suppose a stopped clock is right twice a day.', 'Birdie. I will tell everyone it was my influence.', 'Nice birdie. Do not make me say it again.'],
  par: ['Par. You did the thing you were supposed to do. How novel.', 'Par! Not good, not bad, like a beige hat.', 'A par. The most respectable of the scores, and the dullest.', 'Par, honey. We will call it fine and move along.', 'You made par. It is the least you could do, and you did it.'],
  bogey: ['Bogey. Close enough to par that you can lie to your friends.', 'A bogey. It is the golf version of a participation ribbon.', 'You bogeyed. The hole did not even have to try.', 'Bogey, darling. A little extra for the effort.', 'One over. You are practically a professional, in the wrong direction.'],
  double: ['Double bogey. That is generous of you to give the hole two extra.', 'Two over. At least you are consistent.', 'A double. The scorecard has been through a lot today.', 'Double bogey! Eat something, darling, you look weak.', 'A double. I would be embarrassed, but I am too busy enjoying it.'],
  triple: ['Triple bogey or worse. That hole took years off my life and gave them to you.', 'That was a catastrophe in three acts.', 'A triple. I have seen better outcomes at a casino buffet.', 'Oh, honey. Oh, no. Let us go and get you a sandwich.', 'That hole should come with a warning label and a hug.'],
  none: ['No discs left, sweetheart. They are in my handbag. They are comfortable.', 'Out of discs. I will keep them warm for you.', 'Not a disc remaining. I have a very full handbag today.', 'You are out of discs. Please leave your hopes at the door.', 'All your discs went into my bag. That was fun for me.'],
};
const MORE2_MATCH = {
  holeWin: ['You took the hole off {name}. Look at them squirm.', '{name} is sulking because you beat them. Delicious.', 'That hole is yours. {name} can mind their own business.', 'A win on that one. {name} should have stayed home.'],
  holeLose: ['{name} won that hole. You are not supposed to look so surprised.', 'You lost that one to {name}. We do not speak of it.', '{name} beat you on that hole. I would be hot about it.', 'That one went to {name}. A tragedy in three parts.'],
  holeShare: ['You tied the hole. Nobody wins, nobody loses, nobody enjoys it.', 'A shared hole. The most polite kind of failure.', 'A tie. Boring, but at least nobody gets hurt.', 'The hole is shared. Everyone has to go home and think about it.'],
  win: ['You won! I will pretend this has not ruined my day.', 'Winner! Well. You said you would, and look at you.', 'You beat {name}. It was not close. It felt close, but it was not.', 'A win, honey. Take the glory and go before it changes its mind.'],
  lose: ['{name} won. You played beautifully, until you did not.', 'You lost, darling. Shake hands and hide the evidence.', 'A loss. The only upside is that I get to laugh.', '{name} won, and you get a lovely memory of coming second.'],
  tie: ['A tie. Everybody bought a ticket and nobody got a prize.', 'You tied. Like a bow, only less useful.', 'A tie! The only thing worse is a tie in the rain.', 'A tie. Please go back and finish it off properly.'],
  left: ['You left the match. The discs will be fine. You, I am less sure.', 'You quit. I thought you had more fight than that. I was wrong.', 'You ran away. I saw it. I am telling people.', 'You forfeited. It takes a certain kind of person.'],
};
for (const [k, v] of Object.entries(MORE2_MINE)) MINE[k].push(...v);
for (const [k, v] of Object.entries(MORE2_THEIRS)) THEIRS[k].push(...v);
for (const [k, v] of Object.entries(MORE2_HOLE)) HOLE[k].push(...v);
for (const [k, v] of Object.entries(MORE2_MATCH)) MATCH[k].push(...v);

// A grudging word when a player reaches a goal. {title} and {skin} are filled in.
export const GOAL_SKIN = ['Hmph. {title}. Fine, have a {skin} disc. Do not get used to it.', '{title}, is it? Take the {skin} skin and stop looking at me.', 'Well. {title}. Here is a {skin} disc. I am not smiling, it is the make-up.', '{title}. I suppose that earns you a {skin} disc. I suppose.', 'You did {title}? Sweetheart. Fine. The {skin} disc is yours.', 'Oh, look who did {title}. Have a {skin} disc and a moment of my time.'];
export const GOAL_PLAIN = ['{title}? Do not let it go to your head.', '{title}. I am not impressed. I am slightly impressed.', 'Look at you, doing {title}. I will write it on my fridge.', '{title}, darling. I will allow it.', 'So you did {title}. Good for you. Truly. Mostly.', '{title}! Fine, take a bow. A small one.'];
export const goalLine = (title, skin, rnd = Math.random, avoid = '') => pick(skin ? GOAL_SKIN : GOAL_PLAIN, { title, skin }, rnd, avoid);

// Marebear's bets: she bets against you, and you can take it or not. What each is worth is in BETS below.
export const BETS = {
  par: { text: 'make par or better', win: 3, lose: 2, offer: ['I bet you cannot make par on this one, sweetheart.', 'Par? You? On this hole? Put your bucks where your mouth is.', 'Three bucks says you do not make par. Go on.', 'I bet you cannot make par. Care to prove me wrong, honey?', 'Par on this hole? That is a big ask for someone with your swing.', 'Put three bucks on par and let us see what you are made of.'] },
  bogey: { text: 'make bogey or better', win: 1, lose: 3, offer: ['I bet you cannot even make bogey. Easy money.', 'Bogey or better, honey? I am not so sure. Care to wager?', 'Bet you blow up on this one. Bogey or better, or you pay me.', 'Bogey or better, sweetheart? I will bet you cannot.', 'I am saying you will blow this one. Prove me wrong.', 'A little wager: bogey or better. I do not expect to pay out.'] },
  birdie: { text: 'make birdie or better', win: 8, lose: 1, offer: ['A birdie? From you? Eight bucks says you can not. One buck says you wish you could.', 'Ha! Birdie or better and I will pay you handsomely. Not that I ever have to.', 'Birdie or better. Come on, darling, I am feeling generous and delusional.', 'Eight bucks if you birdie. One buck if you do not. I am being kind.', 'A birdie? On this hole? In your dreams. But in my wallet, maybe.'] },
};
const BETTING = {
  taken: ['Ooh, she is brave. I like that.', 'You are on, sweetheart. Do not cry when I take it.', 'Okay! Shake on it. I do not shake. Just throw.', 'It is a deal! I love it when they say yes.', 'You took my bet. You are braver than you look.', 'Good for you, sweetheart. Now try not to cry.', 'Oh, you are on, honey. I will take your bucks and your dignity.', 'A bet! Ooh, I am so excited my earrings are shaking.'],
  declined: ['Chicken. Bawk bawk.', 'Smart. Cowardly, but smart.', 'No bet? Fine. I will just laugh at you for free.', 'No bet? Fine. Fine. Just throw like a coward, see if I care.', 'You said no. I have a very long memory.', 'Playing it safe. How dull. How very sensible.', 'Not even a little bet? You have no sense of adventure.', 'Declined. Noted. Filed under cowardice.'],
  won: ['Oh, you got me. I will not forget this. Here.', 'Fine, fine, take it. Beginner\'s luck.', 'You won the bet. I hate you a little. Here is your money.', 'You won the bet! I will pay you out of spite.', 'You got me, honey. Here. Do not spend it all in one place.', 'A win! Take your bucks, you beautiful menace.', 'I lost. I never lose. Somebody get my pearls.', 'Fine, take it. I hate how much I like you.'],
  lost: ['Pay up, buttercup!', 'Hand it over, darling. A deal is a deal.', 'And that is how Marebear gets rich.', 'I win! Hand it over, buttercup. Slowly.', 'You lost the bet. Pay up, and smile while you do it.', 'Ha! Right into my handbag. That is a beautiful sound.', 'The house wins, darling, and I am the house.', 'That is what I thought. Please make your payment now.'],
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

// More of her, so no list comes round too soon.
const MORE_MINE = {
  grip: ['Your fingers and that disc are going steady, apparently.', 'Let go, honey. It is a disc, not a baby bird.'],
  early: ['The disc left the building and you were still in it.', 'That one got away from you before you got to it.'],
  shank: ['I have seen better throws from people carrying groceries.', 'Was that on purpose? Please say it was on purpose.'],
  tree: ['The tree has been here for decades. It was not going anywhere.', 'You hit the one tree in the whole county. That takes talent.', 'Wood: one. You: nothing.'],
  water: ['The pond says it was nothing, and gave the disc a hug.', 'Careful, sweetheart, the pond is wet.', 'You fed the pond. It is a good pond.'],
  oob: ['That is the part with the orange line. You were on the wrong side of the orange line.', 'Out of bounds. A very bold choice of address.'],
  rough: ['Rough. It builds character, and you need some.', 'The grass back there is for people who are lost.'],
  rim: ['The basket looked at that and said no, thank you.', 'So close you could smell it. Pity about the result.', 'It touched the basket and left. We have all dated that kind.'],
  soft: ['That putt left home with no plan and no courage.', 'That swipe was a whisper, darling. The basket is hard of hearing.'],
  hard: ['Easy, tiger. It is a putt, not a javelin.', 'You hit that like it said something about your mother.'],
  wide: ['You were aiming at the basket, right? Because the basket was over there.', 'That swipe took a left turn at the wrong basket.'],
  nasty: ['It rolled like it had a train to catch.', 'The disc left on its own. I respect its independence.'],
  longMiss: ['Thirty feet? With that hand? Brave. Very brave.', 'You missed a long one. That is allowed. It is also hilarious.'],
  pure: ['Fine. That was lovely. I have no insults ready for that, so I will stare.', 'Well. Somebody practiced.'],
  ace: ['An ace! Somebody check the basket for magnets.', 'I want to see that again. Slowly. In case it was a trick.'],
  chains: ['In the chains! I suppose even a stopped clock.', 'Chains, chains, chains. Do not get a big head.'],
  sunk: ['From that far? I choose to believe it was a mistake.', 'A long one, in. Your luck must be on holiday.'],
  mando: ['Mando, mando, mando. Three syllables. You missed all of them.', 'You went the wrong way round the post. Sweetie. The arrow.'],
};
const MORE_THEIRS = {
  grip: ['{name} could not let go, and I could not look away.'],
  early: ['{name} released early. The disc was just as surprised.'],
  shank: ['{name} threw a shank. I will remember it fondly.'],
  tree: ['{name} met a tree. It was a short and violent friendship.'],
  water: ['{name} found the water. The water was thrilled.', 'Splash! {name} is making donations to the pond.'],
  oob: ['{name} is out of bounds, and I am delighted.'],
  rim: ['{name} rimmed out. It lipped them and left.'],
  soft: ['{name} putted like they were tiptoeing past a sleeping dog.'],
  hard: ['{name} swiped like they were mad at the basket.'],
  wide: ['{name} putted at an entirely different county.'],
  nasty: ['{name} watched a putt roll away with its dignity.'],
  longMiss: ['{name} missed a long putt, and honestly I enjoyed it.'],
  pure: ['{name} threw a pure one. Please, nobody tell them.'],
  ace: ['{name} just aced it. I need to sit down.'],
  chains: ['{name} made one. Good for them, I suppose.'],
  sunk: ['{name} sank a long one. Lucky, lucky, lucky.'],
  rough: ['{name} is in the rough, where I would expect them.'],
  mando: ['{name} went the wrong side of the mando. Rookie.'],
};
for (const [k, v] of Object.entries(MORE_MINE)) MINE[k].push(...v);
for (const [k, v] of Object.entries(MORE_THEIRS)) THEIRS[k].push(...v);
HOLE.par.push('Par. A perfectly respectable amount of nothing special.', 'Par, honey. You did the bare minimum, and did it well.');
HOLE.bogey.push('A bogey. Do not look at me like that.', 'Bogey. The hole sends its regards.');
HOLE.double.push('Double bogey. That is two extra strokes of pure ambition.', 'A double. The hole thanks you for the visit.');
HOLE.triple.push('Triple or worse. I will light a candle.', 'That was not a hole, that was a hostage situation.');
HOLE.birdie.push('A birdie. Mark the calendar, then forget it.', 'Birdie! Pass the hairspray, I am feeling things.');
HOLE.eagle.push('An eagle. I am not saying you cheated. I am saying I saw nothing.');
MATCH.holeWin.push('You took that hole off {name}. Smug is a good look on you.');
MATCH.holeLose.push('{name} took that one. Do not let them see you cry.');
MATCH.win.push('You won. I will deny I said anything nice about you.');
MATCH.lose.push('{name} won. You were fabulous, darling. You also lost.');

// Lines from public/data/heckles.json (the ones the owner wrote), by their own category names. They are in the second person,
// so when they are about somebody else's throw they are aimed at that player by name.
let CSV = {};
export function useHeckles(data) { CSV = data && typeof data === 'object' ? data : {}; }
const THROW_KEY = { tree: 'Hitting a Tree', water: 'Going in the Water', shank: 'Shanks', grip: 'Grip Locks', early: 'Early Releases', oob: 'Out of Bounds', rim: 'Rimmed Putts' };
const HOLE_KEY = { ace: 'Eagle', eagle: 'Eagle', birdie: 'Birdie', par: 'Par', bogey: 'Bogey', double: 'Double Bogey', triple: 'Double Bogey' };

const fill = (line, vars = {}) => line.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));

/* She does not repeat herself. Once the page gives her a memory (useMemory), every line she says is remembered, and she goes through a
   whole list before she says any line of it again (a list is "used up" when every line of it has been said; then it starts afresh, and
   never begins with the line she just said). The memory is a set of short hashes, so the page can keep it between visits. Without a
   memory (a test, the server) she only avoids the line she said last. */
let said = null;
const hashOf = (s) => { let h = 5381; for (const c of s) h = (Math.imul(h, 33) ^ c.charCodeAt(0)) >>> 0; return h; };
export function useMemory(list) { said = new Set(Array.isArray(list) ? list.filter((n) => Number.isInteger(n)).slice(-1500) : []); }
export const memory = () => (said ? [...said].slice(-1500) : []);
export const forget = () => { said = said ? new Set() : null; };

// Pick a line from a list: one she has not said, and never the one used last. `rnd` is a function returning 0..1.
export function pick(list, vars = {}, rnd = Math.random, avoid = '') {
  if (!list || !list.length) return '';
  const all = list.map((l) => fill(l, vars));
  let pool = all.filter((l) => l !== avoid);
  if (!pool.length) pool = all;
  if (said) {
    let fresh = pool.filter((l) => !said.has(hashOf(l)));
    if (!fresh.length) { // she has said the lot: start the list again (not with the line she just said)
      for (const l of all) said.delete(hashOf(l));
      fresh = pool;
    }
    pool = fresh;
  }
  const line = pool[Math.floor(rnd() * pool.length) % pool.length];
  if (said) { said.add(hashOf(line)); if (said.size > 1500) said.delete(said.values().next().value); }
  return line;
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
  // her own lines and the owner's, in one pool: the owner's are in the second person, so on somebody else's throw they are aimed at them by name
  const own = CSV[THROW_KEY[event]] || [];
  const built = (who === 'me' ? MINE : THEIRS)[event] || [];
  if (!own.length && !built.length) return { text: '', to: '' };
  if (rnd() > chance) return { text: '', to: '' };
  const text = pick([...own, ...built], { name }, rnd, avoid);
  return { text, to: who !== 'me' && own.includes(text) ? name : '' };
}

// a hole finished: how it went (`score` is strokes, or the score a hole you could not finish counts as)
export function holeRemark(strokes, par, holed, rnd = Math.random, avoid = '') {
  if (!holed) return pick(HOLE.none, {}, rnd, avoid);
  const d = strokes - par;
  const key = strokes === 1 ? 'ace' : d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 0 ? 'par' : d === 1 ? 'bogey' : d === 2 ? 'double' : 'triple';
  return pick([...(CSV[HOLE_KEY[key]] || []), ...HOLE[key]], {}, rnd, avoid);
}

// the others in a match: who took the hole, who won the day
export function matchRemark(kind, { name = '' } = {}, rnd = Math.random, avoid = '') {
  return pick(kind === 'lose' ? [...(CSV['Match Results'] || []), ...MATCH.lose] : MATCH[kind], { name }, rnd, avoid); // the owner's words for a loser, and hers
}
export const bearRemark = (mine, name, rnd = Math.random) => pick(mine ? BEAR.mine : BEAR.theirs, { name }, rnd);

export const LINES = { MINE, THEIRS, HOLE, MATCH, BEAR, BETTING }; // for tests
