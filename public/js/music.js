/* Music for the game: a vibe is a YouTube playlist, played by YouTube's own embedded player (the IFrame API), so nothing is hosted here. The bar under the main
   button has the vibe (a drop-up to pick one), play and pause, skip and volume. Nothing plays until the player taps play (browsers do not allow it), and the choice
   (vibe, volume) is remembered in this browser (`dj_music`). `VIBES` and `clampVolume` are pure; everything else needs a page. */

// A vibe is a handful of public playlists, one of which is picked at random each time the page loads (and each time the vibe is picked), so it is not the same hour
// twice. Each is [playlist id, about how many videos], all checked: embeddable, ten or more videos. 'Shuffle' (id mix) draws from all of them, and changes playlist now and then.
export const VIBES = [
  { id: 'jazz', name: 'Chill jazz', sub: 'instrumental', lists: [['PLdYj6oaFCaJV8yFa1Rw6f6hADSSQPbaK8', 25], ['PL4GGTdYKSboFiUVgnaznjliWKlQkymin9', 19], ['PL7C9F345DB5C8626B', 165]] },
  { id: 'steely', name: 'Steely Dan', sub: 'the very best', lists: [['PLe8Z_l5Ergd0_7h2G8DEIjjMHCMByCK7t', 32], ['PLPRIqTHYO-0UpdzUnMmWt9HzdFrKqk152', 28], ['PL4cFJtUcmjZm34rOVb2d7e6Pe5TVGt6yS', 18], ['PLfGibfZATlGrHkjx50oD3emiYjAm6uz8t', 33], ['PLZANLIuAUVxwY_pyIH89AYanJ8gE6j6RM', 102], ['PL2aXYk9zKd22AKiapUvEqKetHoJeowq0z', 18]] },
  { id: 'ween', name: 'Ween', sub: 'best of', lists: [['PLiLi6hpW2yhzLsc7t41lT8CxXeYmlHwVK', 66], ['PLSkQ1J0aAZWWIQIF_6dOnSbFXrM1Jt7ws', 165], ['PLOEHye7OZuQ5F7ZtgmvALtOJKA29PjScU', 52], ['PL82A658F4293132A4', 19]] },
  { id: 'hiphop', name: 'Hip-hop', sub: 'boom bap to now', lists: [['PLqsBPTegBGMG3acuRYMLpDvgC-5esWrZA', 594], ['PLxA687tYuMWgEVasBziZoZ1Bk7JLnu-Rf', 109], ['PLwNv9Hhd8gZjeee8SBwokNf2JhqBvYqeB', 600], ['PL3Yek6nlMeQK7BoxKYDLMi-pjQXXSpo5Q', 30], ['PLiXZsbFff5pE3hkUVO0QK-qNFIoPGZmOI', 149]] },
  { id: 'doom', name: 'Stoner doom', sub: 'fuzz, riffs, slow', lists: [['PLCSNb7TsONG68JX1ygQC7H3RFUkTy5DtW', 144], ['PLNsLUIE-J1TuiUfDxuEgjBGGu88oEqrtv', 79], ['PLuBbiAcdKBNecYJFzpOsmP7deZldMv4PU', 33], ['PLB15oumg1wiOnny8x8FfAxt81qyrEE1Ga', 70], ['PLTTFnSdb4qu16nVJbycS0qzQ7mbLFDHCc', 78], ['PL0F54F1D1FA99AE48', 67], ['PLIHL4G0UP2FQyoi4gUAkkzfybGI4KDvNf', 223]] },
  { id: 'altrock', name: 'Alt rock', sub: '90s and 2000s', lists: [['PLDyMXoYglQpJHbdicyynOj0x95_WUMsjX', 129], ['PLe1yk9GfziGef5c4pNRwVJdkvfB4tnH72', 130], ['PLZt1y58PWniX9ngr_S0sXGamktVkRuIde', 86], ['PLnbMLT2XNYyiILh4i6oQEjDUyT8pYI9Rp', 1933], ['PL6Lt9p1lIRZ311J9ZHuzkR5A3xesae2pk', 575]] },
  { id: 'tinydesk', name: 'Tiny Desk', sub: 'NPR Music', lists: [['PL1B627337ED6F55F0', 1458], ['PLaW73gfnuhn1QPkRQAbqmc3d-qwj5VK4P', 206], ['PL8vCM_9zBJQlJ6eQTBvANiGZwAmo6_lHy', 123]] },
  { id: 'lofi', name: 'Lo-fi', sub: 'beats to play to', lists: [['PLXIclLvfETS3AgCnZg4N6QqHu_T27XKIq', 76], ['PL6fhs6TSspZv0F0YgsG-p7Mn189CU2XKS', 321], ['PLe0XBeaAl1KElgUjwGuNtut0AdjryI4DD', 17]] },
  { id: 'khruangbin', name: 'Khruangbin', sub: 'the best of', lists: [['PLsEph4gwc-zt1tV8Pzbp4cBoYYGcme8bO', 22], ['PLxA687tYuMWganpbwZJMlQjedgz78TaDk', 28], ['PLel8KdUkdX_62mcYtZqsA0bQT2XgbOafe', 22], ['PLU0WDLFA89gDlW7eDb7_oWPTeQqJcqiV8', 46]] },
  { id: 'indie', name: 'Indie', sub: 'rock essentials', lists: [['PL127P7lHFtiTiHsG1VWhk_dWB8NrZ2miu', 91], ['PLOhV0FrFphUfHqxfhIBju7zu_2CTqG01F', 175], ['PLEXox2R2RxZJPZVYvKAQ2CH6wfulo5RHS', 490], ['PLkqz3S84Tw-SWvRC3wbtrtIoczzX3TpdK', 35]] },
  { id: 'altcountry', name: 'Alt country', sub: 'top songs', lists: [['PLChOO_ZAB22WROWLQuMh1COXivVJIuWyP', 60], ['PLbhn7CiDwEY9U7rxY0JHAH24J8_BjLBVs', 76], ['PLs8rX09_ewwkIHsxVShFiLkJ0aIiTeFlP', 70], ['PLMgxZbmrZGj4rn77f2E0mkZv809QdT-u6', 25], ['PLccxN91Cjxt8Nvzf5AL0ohOFGT_9T87B2', 20]] },
];
const ALL = VIBES.flatMap((v) => v.lists);
VIBES.unshift({ id: 'mix', name: 'Shuffle', sub: 'a bit of everything', lists: ALL });
// a playlist for a vibe, chosen at random
export const chooseList = (vibe, rand = Math.random) => { const [list, n] = vibe.lists[Math.floor(rand() * vibe.lists.length)]; return { list, n }; };
export const clampVolume = (v) => Math.max(0, Math.min(100, Math.round(Number(v)) || 0));
export const vibeById = (id) => VIBES.find((v) => v.id === id) || VIBES[0];

const KEY = 'dj_music';
const load = () => { try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); return { vibe: vibeById(s.vibe).id, vol: s.vol === undefined ? 55 : clampVolume(s.vol) }; } catch { return { vibe: VIBES[0].id, vol: 55 }; } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not saved */ } };

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14l9-7zM16 5h3v14h-3z"/></svg>',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zm10-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};

/** Put the music bar into `root` (the page's #gm-music) and wire it up. */
export function initMusic(root) {
  if (!root) return null;
  const st = load();
  let player = null;
  let status = 'idle'; // idle (no player yet) | loading | playing | paused | stuck (the browser would not start it: tap play again)
  let drawerOpen = false;
  let errors = 0;
  let watchdog = 0;
  let broken = false;

  root.innerHTML = `
    <div class="gm-music__drawer" id="gm-music-drawer" hidden role="dialog" aria-label="Pick a vibe">
      <p class="gm-music__h">Pick a vibe <small>streams from YouTube</small></p>
      <div class="gm-music__grid">${VIBES.map((v) => `<button type="button" class="gm-vibe" data-vibe="${v.id}"><b>${v.name}</b><small>${v.sub}</small></button>`).join('')}</div>
      <p class="gm-music__now" id="gm-music-now" aria-live="polite"></p>
    </div>
    <div class="gm-music__bar">
      <button type="button" class="gm-mbtn gm-mbtn--vibe" data-m="vibe" aria-expanded="false" aria-controls="gm-music-drawer" aria-label="Pick a vibe">${ICON.note}<span id="gm-music-vibe"></span><i aria-hidden="true">▴</i></button>
      <button type="button" class="gm-mbtn" data-m="play" aria-label="Play">${ICON.play}</button>
      <button type="button" class="gm-mbtn" data-m="skip" aria-label="Skip to the next song">${ICON.skip}</button>
      <input class="gm-mvol" type="range" min="0" max="100" step="1" value="${st.vol}" aria-label="Music volume">
    </div>
    <div class="gm-music__yt" aria-hidden="true"><div id="gm-yt"></div></div>`;
  const q = (s) => root.querySelector(s);
  const playBtn = q('[data-m="play"]');
  const vibeLabel = q('#gm-music-vibe');
  const now = q('#gm-music-now');

  const render = () => {
    const v = vibeById(st.vibe);
    vibeLabel.textContent = v.name;
    const playing = status === 'playing' || status === 'loading';
    playBtn.innerHTML = playing ? ICON.pause : ICON.play;
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    playBtn.classList.toggle('is-stuck', status === 'stuck');
    root.classList.toggle('is-on', status === 'playing');
    root.querySelectorAll('.gm-vibe').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.vibe === st.vibe)));
    now.textContent = broken ? 'That vibe will not play here right now. Try another.' : status === 'stuck' ? 'Tap play to start.' : player && status !== 'idle' ? (player.getVideoData?.().title || '') : '';
  };

  const loadApi = (cb) => {
    if (window.YT?.Player) { cb(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); cb(); };
    if (!document.querySelector('script[data-yt-api]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.dataset.ytApi = '1';
      s.onerror = () => { status = 'idle'; broken = true; render(); };
      document.head.append(s);
    }
  };

  const startIndex = (n) => Math.floor(Math.random() * Math.max(1, n * 0.9));
  let lastVid = null;
  let songs = 0;
  // a random song from the playlist that is loaded (what 'next' is, here, so it never plays in order)
  const playRandom = () => {
    try {
      const n = (player.getPlaylist() || []).length;
      if (n > 1) player.playVideoAt(Math.floor(Math.random() * n)); else player.nextVideo();
    } catch { /* gone */ }
  };
  // is the song that is playing from the playlist that was asked for? (after a switch, the old song goes on playing for a moment; nothing may be done to the new list until its own song starts)
  const inList = () => { try { const ids = player.getPlaylist() || []; return ids.length > 0 && ids.includes(player.getVideoData().video_id); } catch { return false; } };
  // the shuffle vibe moves to another playlist now and then (a different genre, most likely)
  // Switching lists. A plain loadPlaylist on a player that is playing plays the PREVIOUS list's songs (YouTube's player lags one load behind), so it is stopped first and the
  // new list is loaded a moment later, which does switch (checked: four vibes in a row each played its own first song).
  let switchTimer = 0;
  const switchTo = (c) => {
    lastVid = null;
    songs = 0;
    clearTimeout(switchTimer);
    try { player.stopVideo(); } catch { /* gone */ }
    switchTimer = setTimeout(() => {
      try { player.loadPlaylist({ listType: 'playlist', list: c.list, index: startIndex(c.n) }); player.setVolume(st.vol); } catch { /* gone */ }
      arm();
    }, 300);
  };
  const hop = () => switchTo(chooseList(vibeById('mix')));
  const build = () => {
    status = 'loading';
    broken = false;
    render();
    loadApi(() => {
      const c = chooseList(vibeById(st.vibe));
      player = new window.YT.Player('gm-yt', {
        height: '200', width: '200',
        playerVars: { listType: 'playlist', list: c.list, index: startIndex(c.n), autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
        events: {
          onReady: (e) => { e.target.setVolume(st.vol); e.target.playVideo(); arm(); },
          onStateChange: (e) => {
            const S = window.YT.PlayerState;
            if (e.data === S.PLAYING) {
              clearTimeout(watchdog);
              status = 'playing';
              errors = 0;
              if (inList()) {
                const vid = player.getVideoData?.().video_id;
                if (vid && vid !== lastVid) { // a new song: in the shuffle vibe, about every second song moves to another playlist
                  lastVid = vid;
                  songs += 1;
                  if (st.vibe === 'mix' && songs > 1 && Math.random() < 0.5) hop();
                }
              }
            } else if (e.data === S.ENDED) { playRandom(); return; // (our own shuffle: YouTube's own setShuffle freezes the queue, so a later vibe keeps playing the old one)
            } else if (e.data === S.PAUSED) status = 'paused';
            else if (e.data === S.BUFFERING || e.data === S.UNSTARTED) { if (status !== 'playing') status = 'loading'; }
            render();
          },
          onError: () => { // a video that cannot be played here (blocked, removed): on to the next, and give up on the vibe if they keep failing
            errors += 1;
            if (errors > 6) { broken = true; status = 'paused'; try { player.pauseVideo(); } catch { /* gone */ } render(); return; }
            try { player.nextVideo(); } catch { /* gone */ }
          },
        },
      });
    });
  };
  // a browser may not let a player that was not started by a tap play: say so, and the next tap on play starts it
  const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => { if (status !== 'playing') { status = 'stuck'; render(); } }, 3500); };

  const toggle = () => {
    if (!player) { build(); return; }
    const s = player.getPlayerState?.();
    if (status === 'playing' || s === 1) { player.pauseVideo(); status = 'paused'; render(); return; }
    status = 'loading';
    player.playVideo(); // (called straight from the tap, which is what a phone wants)
    arm();
    render();
  };
  // on to another song; if the player does not move (it can be stuck at the end of a list, or between lists), jump to a random song in it
  const skip = () => {
    if (!player) { build(); return; }
    if (st.vibe === 'mix' && Math.random() < 0.5) { hop(); return; }
    let before = null;
    try { before = player.getVideoData().video_id; } catch { /* gone */ }
    playRandom();
    setTimeout(() => { try { if (player.getVideoData().video_id === before) player.nextVideo(); } catch { /* gone */ } }, 1500); // (if it did not move, the plain next one)
  };
  const pick = (id) => {
    st.vibe = vibeById(id).id;
    save(st);
    broken = false;
    errors = 0;
    if (player) {
      status = 'loading';
      switchTo(chooseList(vibeById(st.vibe)));
    } else build();
    setDrawer(false);
    render();
  };
  const setDrawer = (open) => {
    drawerOpen = open;
    q('#gm-music-drawer').hidden = !open;
    q('[data-m="vibe"]').setAttribute('aria-expanded', String(open));
    root.classList.toggle('is-open', open);
  };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.vibe) pick(b.dataset.vibe);
    else if (b.dataset.m === 'play') toggle();
    else if (b.dataset.m === 'skip') skip();
    else if (b.dataset.m === 'vibe') setDrawer(!drawerOpen);
    b.blur(); // (so Space and Enter go on being the game's keys)
  });
  q('.gm-mvol').addEventListener('input', (e) => { st.vol = clampVolume(e.target.value); save(st); try { player?.setVolume(st.vol); } catch { /* not yet */ } });
  root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') setDrawer(false); }); // the game must not take a key typed on the music bar
  document.addEventListener('pointerdown', (e) => { if (drawerOpen && !root.contains(e.target)) setDrawer(false); }, true);
  setInterval(() => { if (status === 'playing') render(); }, 2500); // (the song's title arrives a moment after it starts, and changes as songs do)
  render();
  return { toggle, pick, get status() { return status; } };
}
