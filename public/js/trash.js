/* Marebear's commentary. She watches every throw and has opinions. This is the game talking, not a chat: lines are picked
   from what just happened (a shank, a splash, a hole in one) and who it happened to. Pure functions: the caller supplies
   the dice, so a test can see every line come out. Keep it cheeky, never cruel, and never about a real person. */

// {name} is whoever it happened to; {disc} is the disc; {n} is a number (feet or strokes)
const MINE = {
  grip: ['Ay, the disc stuck to yer fingers like it didn\'t wanna go neither.', 'That\'s a grip lock, hon. The disc held on for dear life, and I get it.', 'Ya gotta let go of the disc, babe. That\'s the whole sport.', 'Grip lock. Next time try openin\' yer hand, whaddaya think?', 'You and that disc are goin\' steady now, huh?', 'Let go, darlin\'. Nobody\'s takin\' it. Except me.', 'Ya held on so long the disc thought it was bein\' kidnapped.', 'Open the fingers, hon. Open \'em. That\'s the whole trick, I\'m tellin\' ya.', 'A grip lock. I held on to things that long too, but they were diamonds.', 'That disc stayed in yer hand like a coupon at the end of the month.', 'Yer fingers and that disc are goin\' steady, apparently.', 'Let go, hon. It\'s a disc, not a baby bird.'],
  early: ['Early release. The disc left before you did, hon.', 'Ya let go of that like it was hot. It wasn\'t.', 'Early release. The disc was in a hurry, like the Turnpike at five o\'clock.', 'That one slipped out. Maybe yer arm needs a minute, babe.', 'Gone before ya were ready. I know the feeling, I was married three times.', 'That disc left like a guest who heard the check was comin\'.', 'Too early, sweetheart. Patience is a lipstick shade ya never tried.', 'Ya let go like ya remembered the gravy was on.', 'The disc left early. Can\'t blame it, honestly.', 'Premature, hon. Premature. We\'ll leave it there.', 'The disc left the buildin\' and ya were still in it.', 'That one got away from ya before ya got to it.'],
  shank: ['That wasn\'t a throw, hon, that was a cry for help.', 'A shank! I seen leaves with better aim, I\'m tellin\' ya.', 'Bold choice, lettin\' go at that exact moment.', 'The disc did what it could with what ya gave it.', 'Honey, I seen better aim from a toddler with a spoon.', 'That wasn\'t a throw, that was a sneeze with a disc in it.', 'The disc went sideways and so did my opinion of ya.', 'My hairdo\'s got better direction than that, and it\'s held up by prayer.', 'A shank. Do not do that near anything I love, babe.', 'Ya threw that like ya were swattin\' a wasp off yer baked ziti.', 'I seen better throws from people carryin\' groceries to the car.', 'Was that on purpose? Please say it was on purpose.'],
  tree: ['Thunk. The tree didn\'t even move, hon.', 'That tree\'s been there eighty years. You been here two minutes.', 'You and that tree are gonna be great friends.', 'The tree says thanks for stoppin\' by.', 'Trees don\'t move, babe. I keep tellin\' people.', 'The tree stepped out in front of ya. Rude, but also very much yer fault.', 'That tree was mindin\' its business, sweetheart.', 'You and the woods: a love story with a bad ending.', 'Thwack! That tree ain\'t felt this seen in years.', 'The disc and the tree have met. They didn\'t hit it off.', 'Trees don\'t move, hon. I told ya. I told the whole county.', 'That tree\'s been here for decades. It wasn\'t goin\' nowhere.', 'Ya hit the one tree in the whole county. That takes talent.', 'Wood: one. You: nothin\'.'],
  mando: ['Ya missed the mando. The big red post. Wit\' the arrow on it.', 'Wrong side of the post, sweetheart. They put an arrow on it for ya.', 'A mando\'s a rule, not a suggestion. One stroke, and do it again.', 'The mando\'s the red post, hon. The post. The red one.', 'Ya went the wrong side of the mando. That\'s a stroke and an eye roll.', 'A mando\'s a signpost wit\' opinions. Ya ignored its opinions.', 'Ya can\'t go that way. It said so. Wit\' an arrow.', 'One stroke for the mando, and one for bein\' stubborn.', 'The post pointed. Ya went the other way. Bold, and wrong.', 'Mando, mando, mando. Ya missed all of \'em.', 'Ya went the wrong way round the post, hon. The arrow.'],
  water: ['Splash! The fish are thrilled, hon.', 'Ya threw a perfectly good disc in a pond. I\'ll remember this.', 'That disc is now a pond decoration.', 'The water was thirsty. Now it\'s got a disc.', 'Whaddaya think, it could swim? It can\'t.', 'Sploosh. I hope that disc could swim, \'cause nobody gave it lessons.', 'Ya gave the pond a gift. It ain\'t gonna write a thank-you card.', 'The fish got a new frisbee and they got you to thank.', 'Into the drink! Hand me one, I need it more than the disc did.', 'That water\'s been waitin\' all day for somebody like you.', 'Ya threw it in the pond. The pond says thanks and ya owe it a disc.', 'The pond says it was nothin\' and gave the disc a hug.', 'Careful, sweetheart, the pond\'s wet.', 'Ya fed the pond. It\'s a good pond.'],
  oob: ['Out of bounds. The line was right there, hon. Dashed. Orange.', 'Ya found the part of the course where discs go to get forgotten.', 'Nobody told ya there\'s an edge? There\'s an edge.', 'Out of bounds, hon. The orange line ain\'t a suggestion, it\'s a hobby.', 'Yer off the map. I\'d send a search party but I\'m between hobbies.', 'That disc left the property. Now it\'s somebody else\'s problem. Yers.', 'The boundary\'s there for yer protection, darlin\'. And my amusement.', 'Ya threw it where discs go to retire.', 'A penalty stroke. The line\'s orange, it\'s dashed, and ya went right through it.', 'That\'s the part wit\' the orange line. Ya were on the wrong side of it.', 'Out of bounds. A very bold choice of address.'],
  rough: ['Rough. Like yer day, hon.', 'That\'s what the fairway looked like from far away.', 'The rough thanks ya for visitin\'.', 'The rough, darlin\'. Lovely place, if ya like weeds.', 'Rough lie. Rough day. Rough hair. A theme is formin\'.', 'Ya landed in the weeds. At least the weeds are happy to see ya.', 'That\'s long grass, sweetheart. Bring a flashlight and a good attitude.', 'Not fairway. Not even close. But the grass is thrilled.', 'Yer in the rough, and I\'m sorry, but I\'m also takin\' notes.', 'Rough. It builds character, and ya need some.', 'The grass back there\'s for people who are lost.'],
  rim: ['Rimmed out! So close, so useless, hon.', 'The basket spit ya out. It\'s got standards.', 'Almost counts in horseshoes. This ain\'t horseshoes.', 'That putt had its chance and said no thank you.', 'It hit the cage, it hesitated, it left. Like my second husband.', 'The basket said maybe, and then it said no.', 'A rim out. The cruelest part of the sport, and I watched bingo night at the VFW.', 'So close the basket felt it. Not close enough to keep it.', 'That disc visited the basket and went home. Rude.', 'The chains looked at ya and sighed. I felt that sigh.', 'The basket looked at that and said no, thank you.', 'So close ya could smell it. Pity about the result.', 'It touched the basket and left. We all dated that guy.'],
  soft: ['Ya babied that one. It never had a chance of gettin\' there.', 'That swipe had all the conviction of a handshake from a ghost.', 'Short. Ya swiped like ya were wipin\' a window.', 'That was a love tap. The basket wanted a kiss and got a handshake.', 'Too soft, darlin\'. Ya putted like ya were apologizin\' to it.', 'It died on the way. We should say a few words. Short ones.', 'Ya swiped that like ya were butterin\' toast for somebody ya don\'t like.', 'Gentle! That disc coulda used a pep talk.', 'The disc ran out of courage halfway there. So did you.', 'That putt left home wit\' no plan and no courage.', 'That swipe was a whisper, hon. The basket\'s hard of hearin\'.'],
  hard: ['Ya swiped that like it owed ya money.', 'Way too hard, hon. It ain\'t a hockey puck.', 'Ya hammered it. The basket don\'t need to be impressed.', 'Way too hard, sweetheart. The basket ain\'t a punchin\' bag.', 'Ya swiped that like it insulted my baked ziti.', 'Too much arm. The disc is tremblin\'.', 'That putt left at a speed meant for emergencies.', 'Whoa, Nelly. It\'s a putt, not a getaway.', 'Ya hit that like ya had a bus to catch.', 'Easy, tiger. It\'s a putt, not a javelin.', 'Ya hit that like it said somethin\' about yer mother.'],
  wide: ['Yer swipe pointed at a different basket entirely.', 'Off line, hon. The basket was right there. It\'s orange.', 'That swipe had a mind of its own, and it was wrong.', 'That swipe was headin\' for a basket, just not this one.', 'Off line, hon. The line\'s the one thing that was free.', 'Ya aimed at a basket and the disc picked another one. Mutiny.', 'Left, right, wherever, as long as it ain\'t toward the basket.', 'The disc and the basket ain\'t on speakin\' terms after that.', 'Ya missed the line by a mile and the basket by two.', 'Ya were aimin\' at the basket, right? \'Cause the basket was over there.', 'That swipe took a left turn at the wrong basket.'],
  nasty: ['That putt took a nasty roll and kept goin\'. I felt that one.', 'It rolled off like it had somewhere better to be.', 'A nasty roll. Gravity\'s got opinions about ya.', 'It ran and ran. Ya can walk it down, I guess.', 'That putt rolled off like it saw a sale somewhere else.', 'It rolled and rolled. I woulda given it a ride.', 'A nasty roll. Even the grass couldn\'t stop it.', 'That disc\'s got a mind of its own, and it\'s takin\' a road trip down the Parkway.', 'Yer gonna be walkin\' to fetch that one. Good for yer circulation.', 'Off it went, rollin\' away like a rumor.', 'It rolled like it had a train to catch.', 'The disc left on its own. I respect its independence.'],
  longMiss: ['Past thirty feet the target\'s a pinprick. Whaddaya expect?', 'A putt that long? Optimism is lovely, but it ain\'t a skill.', 'Ya missed a thirty-footer. Join the club. It\'s large.', 'A long one, hon. Nobody\'s judgin\' ya. Okay, I\'m judgin\' ya a little.', 'Ya didn\'t make it from there. Neither would the Pope.', 'From that far, I give ya credit for tryin\'. Credit\'s all I give.', 'A long putt missin\' ain\'t a tragedy, it\'s just Tuesday.', 'Ya tried a miracle. They\'re booked this week.', 'That was a long shot, and it behaved like a long shot.', 'Thirty feet? Wit\' that hand? Brave. Very brave.', 'Ya missed a long one. That\'s allowed. It\'s also hilarious.'],
  pure: ['Fine. That was good. Don\'t let it go to yer head.', 'A pure throw. Savor it, there won\'t be many.', 'Okay, okay, show-off.', 'Oh, that was pretty. Don\'t look at me, I ain\'t clappin\'.', 'A beautiful throw. I\'m pretendin\' to be unimpressed.', 'Look at you. Releasin\' like ya mean it.', 'That was clean enough to eat off. Don\'t eat off the disc.', 'Textbook. If the textbook was written by somebody who liked ya.', 'Ya threw that perfectly, and I\'m furious about it.', 'Fine. That was lovely. I got no insults ready, so I\'ll just stare.', 'Well, well. Somebody practiced.'],
  ace: ['A hole in one?! I\'m gonna pretend I didn\'t see that.', 'An ace. Nobody\'s gonna believe ya.', 'Hole in one. The disc golf gods are clearly confused.', 'A hole in one. I need a lie down and a glass of somethin\'.', 'An ace! I take back everything I said. Some of it.', 'That ain\'t luck, that\'s witchcraft, and I want the recipe.', 'Hole in one, and nobody here\'s gonna believe ya. Not even me.', 'In one! I could kiss ya. I won\'t, the lipstick\'s new.', 'I seen it wit\' my own eyes and I\'m still filin\' a complaint.', 'An ace! Somebody check the basket for magnets.', 'I wanna see that again. Slowly. In case it was a trick.'],
  chains: ['Chains! Don\'t get used to it, hon.', 'In from out there? Fine. I\'ll be here when it stops workin\'.', 'In the chains! Listen to that sound. I\'ll never admit I like it.', 'It went in. I\'ll allow it, this once.', 'The basket took it. Don\'t look so pleased.', 'Chains! Even I didn\'t see that comin\', and I see everything.', 'Nice one. It won\'t last, but nice one.', 'In it goes. A round of applause, performed internally.', 'In the chains! I suppose even a stopped clock.', 'Chains, chains, chains. Don\'t get a big head.'],
  sunk: ['Ya made a long one. Enjoy it, I\'m sure ya ain\'t gonna repeat it.', 'Chains from way out. Even a broken clock.', 'Ya made it from way out there. Geez. Somebody pinch me.', 'That was a long one and it went in. Fine. Marvelous. Whatever.', 'A long putt, in the chains. I need a minute wit\' my compact.', 'From that distance? Yer either gifted or guilty.', 'Drained it. I\'ll be tellin\' people it was my idea.', 'Long range, no problem. Show-off, darlin\'. Show-off.', 'From that far? I choose to believe it was a mistake.', 'A long one, in. Yer luck must be on vacation down the Shore.'],
};
const THEIRS = {
  grip: ['{name} got a grip lock. The disc just refused.', '{name} couldn\'t let go of the disc. We all been there.', '{name} is still holdin\' that disc, in spirit.', '{name} had a grip lock. Some people just can\'t let go.', '{name} couldn\'t release it. A commitment problem, I\'d say.', 'Grip lock for {name}. I know that kinda clinginess.', '{name} couldn\'t let go, and I couldn\'t look away.'],
  early: ['{name} released early. The disc left without \'em.', '{name} let go too soon, and the disc said goodbye.', '{name} let go early. The disc wasn\'t ready, and neither was {name}.', 'An early release from {name}. Happens to the best of us, apparently.', '{name} released too soon, and the disc hit the road.', 'Premature, {name}. That\'s all I\'ll say.', '{name} released early. The disc was just as surprised.'],
  shank: ['{name} shanked it. Please clap, but quietly.', 'That\'s a shank from {name}. A glorious one.', '{name} shanked it. I\'ll light a candle for the disc.', 'A shank from {name}. The disc is filin\' for divorce.', '{name} threw that sideways on purpose, right? Right?', 'That was ugly, {name}. Gorgeous, but ugly.', '{name} threw a shank. I\'ll remember it fondly.'],
  tree: ['{name} found a tree. They\'re old friends now.', 'Thunk. {name} lost to a tree.', '{name} hit a tree. The tree won.', '{name} and the tree. It was always gonna end like this.', 'The tree stopped {name}. That tree\'s got a future in security.', '{name} hit the wood. I heard it from here.', 'Thwack! {name} found out trees are solid.', '{name} met a tree. It was a short and violent friendship.'],
  mando: ['{name} missed the mando. There was a sign.', '{name} went the wrong side of the post. Rules are rules.', '{name} missed the mando. Arrow, post, everything. Gone.', 'The mando got {name}. A stroke, and a lesson.', '{name} went the wrong way round the post. The post is hurt.', '{name} ignored the arrow. I\'m writin\' it up now.', '{name} went the wrong side of the mando. Rookie.'],
  water: ['{name} threw a disc in the water. A moment of silence.', 'Splash. {name} is feedin\' the fish.', '{name} went for a swim. The disc, not {name}.', '{name} threw it in the pond. The fish are applaudin\'.', 'Sploosh. {name} is now a pond contributor.', '{name} found the water. Somebody get a towel for the disc.', 'The pond thanks {name} for the donation.', '{name} found the water. The water was thrilled.', 'Splash! {name} is makin\' donations to the pond.'],
  oob: ['{name} went out of bounds. The line\'s orange, {name}.', '{name} found out where the course ends.', '{name} is out of bounds. Somebody send a postcard.', '{name} threw it off the map. Bold.', 'Out of bounds for {name}. The orange line wins again.', '{name} left the course. The disc did, anyway.', '{name} is out of bounds, and I\'m delighted.'],
  rim: ['{name} rimmed out. The basket said no.', '{name} was one inch from glory and couldn\'t be bothered.', '{name} rimmed out. The basket looked away.', 'So close, {name}. So very, very close. Hee.', 'The disc kissed the basket and kept walkin\'. Sorry, {name}.', '{name} got the rim and nothin\' else.', '{name} rimmed out. It lipped \'em and left.'],
  soft: ['{name} babied that putt and it died short.', '{name} putted like a library voice. The disc fell short.', 'Too gentle, {name}. The basket needs a firmer hand.', '{name} left it short. It didn\'t have the energy.', 'Not enough oomph from {name}. It never arrived.', '{name} putted like they were tiptoein\' past a sleepin\' dog.'],
  hard: ['{name} swiped that one way too hard.', '{name} putted that like it owed \'em money.', 'Easy, {name}. The basket did nothin\' to ya.', '{name} swiped wit\' a little too much feelin\'.', 'That was a lot of power from {name}, and nowhere to put it.', '{name} swiped like they were mad at the basket.'],
  wide: ['{name} putted it somewhere near the basket, and not near enough.', '{name} swiped that wide. The basket\'s over there, hon.', 'Off line for {name}. The line\'s right there. It\'s the whole point.', '{name} missed the line and the basket in one move.', 'The disc went anywhere but the basket, thanks to {name}.', '{name} putted at an entirely different county.'],
  nasty: ['{name} putted it and it rolled off into the next county.', '{name} took a nasty roll. Somebody fetch it.', '{name} watched a putt roll off into the sunset.', 'The disc took off on {name}. It had plans.', 'A nasty roll for {name}. I felt it in my knees.', '{name} is goin\' for a walk. The disc started it.', '{name} watched a putt roll away wit\' its dignity.'],
  longMiss: ['{name} missed a long putt. Tough, but honestly, expected.', '{name} missed a long one. Nobody\'s shocked.', 'A hopeful putt from {name}. Hope ain\'t a technique.', '{name} tried a long one and the long one said no.', 'Long miss, {name}. A fine try. A terrible result.', '{name} missed a long putt, and honestly I enjoyed it.'],
  pure: ['{name} threw a pure one. I suppose that\'s allowed.', 'Nice throw from {name}. Don\'t tell \'em I said so.', '{name} threw a good one. I\'m pretendin\' I didn\'t see it.', 'A pure throw from {name}. Fine. Lovely. Movin\' on.', '{name} released that perfectly. It made me feel unwell.', 'Pretty throw, {name}. Don\'t let it go to yer head.', '{name} threw a pure one. Please, nobody tell \'em.'],
  ace: ['{name} just aced it. I wanna see the footage.', 'A hole in one for {name}. Somebody check the basket for cheatin\'.', '{name} aced it! I\'m gonna need a fan.', 'An ace from {name}. Somebody check \'em for magnets.', '{name} got a hole in one. The rest of youse can go home.', 'Hole in one for {name}. I\'m speechless, and that never happens.', '{name} just aced it. I gotta sit down.'],
  chains: ['{name} holed out. Show-off.', '{name} made it. It was probably an accident.', 'In the basket for {name}. Mark it down, then forget it.', '{name} holed out. Good for \'em. Truly. Mostly.', 'Chains for {name}. It makes a lovely sound. I ain\'t sayin\' it twice.', '{name} made one. Good for \'em, I suppose.'],
  sunk: ['{name} drained a long one. Luck, obviously.', '{name} sank a long one. Luck\'s a fickle lady, and she likes {name}.', 'A long putt in for {name}. I gotta sit down.', '{name} drained it from way out. I hate that I enjoyed it.', 'From that far? {name}, yer makin\' the rest of us look bad.', '{name} sank a long one. Lucky, lucky, lucky.'],
  rough: ['{name} is in the rough. A fine place to be, for \'em.', '{name} landed in the rough. It suits \'em.', '{name} is in the weeds. I\'ll send flowers.', 'Rough lie for {name}. The grass is thrilled.', '{name} found the long grass. It was waitin\' for \'em.', '{name} is in the rough, where I\'d expect \'em.'],
};
const HOLE = {
  ace: ['An ace! I got no notes.', 'A hole in one. I ain\'t gonna say nothin\'. I\'m just gonna stare.', 'A hole in one! Hand me my smellin\' salts.', 'An ace. I don\'t trust it, I don\'t trust ya, but I\'m happy.', 'One throw. One. I\'m gonna need a drink and a wig adjustment.', 'An ace! The stuff of legend, and I was here for it.', 'Hole in one, hon. Don\'t tell people ya did it. Tell \'em I made ya.'],
  eagle: ['An eagle! Who let you in?', 'Eagle. That was either very good or very lucky, and I ain\'t askin\' which.', 'An eagle! I shoulda worn my good earrings.', 'Two under, sweetheart. Somebody write this down.', 'Eagle. Ya got my respect and my suspicion.', 'An eagle on a day like this? The universe is confused.', 'Eagle! Yer on fire, and I wanna know who ya paid.', 'An eagle. I ain\'t sayin\' ya cheated. I\'m sayin\' I saw nothin\'.'],
  birdie: ['A birdie. Fine. Don\'t make it a habit.', 'Birdie! I\'ll allow it.', 'A birdie, hon. Look at you, behavin\' like a professional.', 'Birdie! Don\'t let it go to yer head. It won\'t fit anyway.', 'One under. I suppose a stopped clock is right twice a day.', 'Birdie. I\'ll tell everybody it was my influence.', 'Nice birdie. Don\'t make me say it again.', 'A birdie. Mark the calendar, then forget it.'],
  par: ['Par. Perfectly average. Enjoy yer trophy for showin\' up.', 'Par. Nobody\'s writin\' a song about it, but well done.', 'Par. Ya did the thing ya were supposed to do. How novel.', 'Par! Not good, not bad, like a beige hat.', 'A par. The most respectable of the scores, and the dullest.', 'Par, hon. We\'ll call it fine and move along.', 'Ya made par. It\'s the least ya could do, and ya did it.', 'Par. A perfectly respectable amount of nothin\' special.', 'Par, hon. Ya did the bare minimum, and did it good.'],
  bogey: ['Bogey. The hole won, but only a little.', 'A bogey. It ain\'t a crime. It is, however, a bogey.', 'Bogey. Close enough to par that ya can lie to yer friends.', 'A bogey. It\'s the golf version of a participation ribbon.', 'Ya bogeyed. The hole didn\'t even have to try.', 'Bogey, darlin\'. A little extra for the effort.', 'One over. Yer practically a pro, in the wrong direction.', 'A bogey. Don\'t look at me like that, hon.'],
  double: ['Double bogey! That\'s a lotta disc golf for one hole.', 'A double bogey. At least ya got yer steps in.', 'Double bogey. That\'s generous of ya to give the hole two extra.', 'Two over. At least yer consistent.', 'A double. The scorecard\'s been through a lot today.', 'Double bogey! Eat somethin\', darlin\', ya look weak.', 'A double. I\'d be embarrassed, but I\'m too busy enjoyin\' it.', 'Double bogey. That\'s two extra strokes of pure ambition.'],
  triple: ['Triple bogey or worse. I\'d like to see that scorecard framed.', 'That hole took everything ya had, and then some.', 'Okay, let\'s call that one a practice hole and never speak of it again.', 'Triple bogey or worse. That hole took years off my life and gave \'em to you.', 'That was a catastrophe in three acts.', 'A triple. I seen better outcomes at the Atlantic City buffet.', 'Oh, hon. Oh, no. Let\'s go get ya a sandwich.', 'That hole should come wit\' a warnin\' label and a hug.', 'Triple or worse. I\'ll light a candle.'],
  none: ['No discs left. They\'re all in my handbag, and I regret nothin\'.', 'No discs left, sweetheart. They\'re in my handbag. They\'re comfortable.', 'Outta discs. I\'ll keep \'em warm for ya.', 'Not a disc remainin\'. I got a very full handbag today.', 'Yer outta discs. Please leave yer hopes at the door.', 'All yer discs went into my bag. That was fun for me.'],
};
const MATCH = {
  holeWin: ['Ya took that hole. {name} is lookin\' at the ground.', 'Ya beat {name} on that one. Do ya feel big? Ya should.', 'Ya took the hole off {name}. Look at \'em squirm.', '{name} is sulkin\' \'cause ya beat \'em. Delicious.', 'That hole\'s yers. {name} can mind their own business.', 'A win on that one. {name} shoulda stayed home.', 'Ya took that hole off {name}. Smug is a good look on ya.'],
  holeLose: ['{name} took that hole off ya. Their discs know the way and yers don\'t.', 'Lost that one to {name}. They\'re gonna bring it up.', '{name} won that hole. Ya ain\'t supposed to look so surprised.', 'Ya lost that one to {name}. We don\'t speak of it.', '{name} beat ya on that hole. I\'d be hot about it.', 'That one went to {name}. A tragedy in three parts.', '{name} took that one. Don\'t let \'em see ya cry.'],
  holeShare: ['A shared hole. Everybody cringe a little.', 'Ya tied the hole. Nobody wins, nobody loses, nobody enjoys it.', 'A shared hole. The most polite kinda failure.', 'A tie. Borin\', but at least nobody gets hurt.', 'The hole is shared. Everybody\'s gotta go home and think about it.'],
  win: ['Ya won. I\'m as surprised as you are.', 'Winner! {name} is gonna be tellin\' people it was a fluke.', 'Ya won! I\'ll pretend this ain\'t ruined my day.', 'Winner! Well. Ya said ya would, and look at you.', 'Ya beat {name}. It wasn\'t close. It felt close, but it wasn\'t.', 'A win, hon. Take the glory and go before it changes its mind.', 'Ya won. I\'ll deny I said anything nice about ya.'],
  lose: ['{name} wins. Ya were there, which counts for somethin\'.', 'Ya lost. I\'m sure it was the wind.', 'Ya came, ya threw, ya didn\'t win.', '{name} won. Ya played beautifully, until ya didn\'t.', 'Ya lost, darlin\'. Shake hands and hide the evidence.', 'A loss. The only upside is I get to laugh.', '{name} won, and ya get a lovely memory of comin\' in second.', '{name} won. Ya were fabulous, darlin\'. Ya also lost.'],
  tie: ['A tie! The most borin\' result there is.', 'A tie. Everybody bought a ticket and nobody got a prize.', 'Ya tied. Like a bow, only less useful.', 'A tie! The only thing worse is a tie in the rain.', 'A tie. Please go back and finish it off proper.'],
  left: ['Ya left. The discs are still out there, judgin\' ya.', 'Ya left the match. The discs\'ll be fine. You, I\'m less sure.', 'Ya quit. I thought ya had more fight than that. I was wrong.', 'Ya ran away. I saw it. I\'m tellin\' people.', 'Ya forfeited. It takes a certain kinda person.'],
};

// A grudging word when a player reaches a goal. {title} and {skin} are filled in.
export const GOAL_SKIN = ['Hmph. {title}. Fine, have a {skin} disc. Don\'t get used to it.', '{title}, is it? Take the {skin} skin and stop lookin\' at me.', 'Well. {title}. Here\'s a {skin} disc. I ain\'t smilin\', it\'s the make-up.', '{title}. I suppose that earns ya a {skin} disc. I suppose.', 'Ya did {title}? Sweetheart. Fine. The {skin} disc is yers.', 'Oh, look who did {title}. Have a {skin} disc and a moment of my time.'];
export const GOAL_PLAIN = ['{title}? Don\'t let it go to yer head.', '{title}. I ain\'t impressed. I\'m slightly impressed.', 'Look at you, doin\' {title}. I\'ll put it on my fridge.', '{title}, darlin\'. I\'ll allow it.', 'So ya did {title}. Good for you. Truly. Mostly.', '{title}! Fine, take a bow. A small one.'];
export const goalLine = (title, skin, rnd = Math.random, avoid = '') => pick(skin ? GOAL_SKIN : GOAL_PLAIN, { title, skin }, rnd, avoid);

// Marebear's bets: she bets against you, and you can take it or not. What each is worth is in BETS below.
export const BETS = {
  par: { text: 'make par or better', win: 3, lose: 2, offer: ['I bet ya can\'t make par on this one, sweetheart.', 'Par? You? On this hole? Put yer bucks where yer mouth is.', 'Three bucks says ya don\'t make par. Go on.', 'I bet ya can\'t make par. Care to prove me wrong, hon?', 'Par on this hole? That\'s a big ask for somebody wit\' yer swing.', 'Put three bucks on par and let\'s see whatcha made of.'] },
  bogey: { text: 'make bogey or better', win: 1, lose: 3, offer: ['I bet ya can\'t even make bogey. Easy money.', 'Bogey or better, hon? I ain\'t so sure. Care to wager?', 'Bet ya blow up on this one. Bogey or better, or ya pay me.', 'Bogey or better, sweetheart? I\'ll bet ya can\'t.', 'I\'m sayin\' ya blow this one. Prove me wrong.', 'A little wager: bogey or better. I don\'t expect to pay out.'] },
  birdie: { text: 'make birdie or better', win: 8, lose: 1, offer: ['A birdie? From you? Eight bucks says ya can\'t. One buck says ya wish ya could.', 'Ha! Birdie or better and I\'ll pay ya handsome. Not that I ever gotta.', 'Birdie or better. C\'mon, darlin\', I\'m feelin\' generous and delusional.', 'Eight bucks if ya birdie. One buck if ya don\'t. I\'m bein\' kind.', 'A birdie? On this hole? In yer dreams. But in my wallet, maybe.'] },
};
const BETTING = {
  taken: ['Ooh, she\'s brave. I like that.', 'Yer on, sweetheart. Don\'t cry when I take it.', 'Okay! Shake on it. I don\'t shake. Just throw.', 'It\'s a deal! I love it when they say yes.', 'Ya took my bet. Yer braver than ya look.', 'Good for you, sweetheart. Now try not to cry.', 'Oh, yer on, hon. I\'ll take yer bucks and yer dignity.', 'A bet! Ooh, I\'m so excited my earrings are shakin\'.'],
  declined: ['Chicken. Bawk bawk.', 'Smart. Cowardly, but smart.', 'No bet? Fine. I\'ll just laugh at ya for free.', 'No bet? Fine. Fine. Just throw like a coward, see if I care.', 'Ya said no. I got a very long memory.', 'Playin\' it safe. How dull. How very sensible.', 'Not even a little bet? Ya got no sense of adventure.', 'Declined. Noted. Filed under cowardice.'],
  won: ['Oh, ya got me. I won\'t forget this. Here.', 'Fine, fine, take it. Beginner\'s luck.', 'Ya won the bet. I hate ya a little. Here\'s yer money.', 'Ya won the bet! I\'ll pay ya outta spite.', 'Ya got me, hon. Here. Don\'t spend it all in one place.', 'A win! Take yer bucks, ya beautiful menace.', 'I lost. I never lose. Somebody get my pearls.', 'Fine, take it. I hate how much I like ya.'],
  lost: ['Pay up, buttercup!', 'Hand it over, darlin\'. A deal\'s a deal.', 'And that\'s how Marebear gets rich.', 'I win! Hand it over, buttercup. Slowly.', 'Ya lost the bet. Pay up, and smile while ya do it.', 'Ha! Right into my handbag. That\'s a beautiful sound.', 'The house wins, darlin\', and I\'m the house.', 'That\'s what I thought. Please make yer payment now.'],
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

const BEAR = { mine: ['Don\'t look at me, hon. Ya earned it.'], theirs: ['{name} is at a triple bogey. Marebear is reachin\' for her handbag.'] };

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
