# focusroom

A calm, aesthetic focus dashboard: a big clock, a Pomodoro timer, tasks, ambient sounds and animated scenes, plus a **private study room with voice chat for you and up to three friends**.

**Live:** https://avgrobo999.github.io/focus-room/

## Features

- **Three modes:** Home (clock, greeting, today's focus, quote), Focus (timer + current task) and Ambient (just the scene, with a small timer in the corner)
- **Timer:** Pomodoro with presets (25/5, 50/10, Animedoro 40/20, 15/3, custom), countdown or stopwatch. Auto-start options, session tally, the clock time your session will end, alert sounds and desktop notifications
- **Tasks:** your top unfinished task becomes your current focus. Drag to reorder and estimate sessions per task
- **Ambient sounds:** 18 layerable sounds synthesized live in the browser (rain, thunder, wind, waves, stream, campfire, birds, crickets, typing, clock, white/pink/brown noise, binaural beats), plus one-click soundscapes
- **Music:** built-in lofi/synthwave streams and Spotify playlists, or paste any YouTube or Spotify link. Play/pause from the panel; YouTube playlists also get previous/next, shuffle and a volume slider. The sidebar button in the Music panel turns it into a tall sidebar on the right, so a Spotify playlist shows its whole track list next to the timer
- **Themes:** 8 animated canvas scenes, 22 live nature videos (waterfalls, streams, beaches at sunset, rain and snow) that loop with no visible seam, a snowy starry sky with shooting stars, or upload your own
- **Big quote:** click the quote to show it large above the clock or timer (`Q` toggles)
- **Pop-out timer:** in Chrome and Edge on desktop, the dock's pop-out button (or `P`) puts the timer in a small always-on-top window that stays in view when you switch tabs or minimise the browser. Chrome can also pop it out by itself when you switch tabs, during a voice call or if you allow *Automatic picture-in-picture* in the site settings
- **Install as an app:** in Chrome or Edge, Settings → *Install as an app* (or the install icon in the address bar) gives focusroom its own window and icon. In the app, pressing Start pops the timer out into that always-on-top window, so it stays above your other apps while you work. Turn this off or on for the browser too with *Keep the timer on top*. A web app can't pin its own main window on top; the pop-out is the window browsers keep above everything
- **Labelled dock:** each dock button has its name underneath (Sounds, Music, Tasks, Stats, Themes, Friends, Settings, Pop out, Full screen)
- **Fits any window:** the clock, timer and quote scale with the window's width and height, in the browser, the installed app or the pop-out, down to a phone held sideways
- **Stats:** today, last 7 days, streak, monthly and all-time focus time, recent sessions. Sign in with Google under Focus stats and your focus log follows your account to any device. It's kept in a hidden app-only folder in your own Google Drive, and devices merge their sessions instead of overwriting each other ([privacy](privacy.html))
- **Study room (up to 4 people):**
  - Create a room, sign in with Google, and send the invite link. It's end-to-end encrypted
  - **Voice call:** join or leave voice, mute (`V`), deafen (`D`), see who's talking, and set each person's volume. Audio goes browser to browser and is never recorded
  - **Sync timers** (on by default): start, pause and skip together
  - **Sync themes** (off by default): when you change your theme, everyone's changes with it. Both toggles are in the room panel and in Settings
  - See what everyone is working on and how long they have left
  - Group chat, emoji reactions and one-off theme sharing
  - Anyone can drop out and rejoin. If the person hosting the room leaves, someone else takes over automatically. A fifth visitor sees "room full"

## How the room is secured

- **Sign in with Google (rooms only).** Everyone signs in with [Google Identity Services](https://developers.google.com/identity/gsi/web). Each browser checks the ID tokens of the people it connects to itself: Google's RS256 signature, issuer, audience (this app's client ID), expiry, verified email, and a nonce tied to this one room, so a token can't be reused in any other room or app. You can also **lock a room** to up to five Google accounts, with one click once your friends have joined.
- **Unguessable meeting point.** The room's address on the broker is a hash of the code *and* the secret, so someone who only sees the room code (say, in a screenshot) can't find, join or jam the room.
- **End-to-end encryption.** The invite link looks like `…/focus-room/#r=<code>.<secret>`. The 128-bit secret lives in the URL fragment, which browsers never send to a server. Every message is sealed with AES-256-GCM using a key derived from it with HKDF. A challenge/response handshake proves the other side holds the key, and sequence numbers block replays. That keeps GitHub, the PeerJS broker and any relay out: they can't read or forge room traffic.
- **No server of our own.** The public [PeerJS](https://peerjs.com) broker only introduces the browsers. After that, traffic flows directly over WebRTC. Nothing is stored server-side.
- **How a group room works.** The first person in holds the room (the "anchor"). Everyone else connects to the anchor, which checks each newcomer's invite key and Google sign-in, and passes encrypted messages along. You verify the anchor yourself; the other members are vouched for by the anchor. If the anchor leaves, the remaining people pick a new one and verify each other again.
- **Voice calls.** Each pair of people in the call gets a direct, DTLS-SRTP-encrypted WebRTC audio link (a small mesh, which suits four people). The call setup (SDP offers and network candidates) is sent only over the end-to-end encrypted room channel. The PeerJS broker never sees it, and nobody can slip into the call without the room key. Turning your mic on needs your browser's permission. Muting disables your microphone track, so nothing is sent while you're muted.
- **Hardening:**
  - Strict Content-Security-Policy, and the app refuses to run inside a frame.
  - Strict validation and rate-limiting of everything a friend sends.
  - Focus stats only credit time that really passed on your own device.
  - Test hooks only work on `localhost`.
- **Still true:** direct peer-to-peer connections let the browsers in a room learn each other's IP addresses (everyone's, once you're in a voice call together). Only share invites with people you trust. Wear headphones in calls to avoid echo.

### Setup: Google client ID

Create an OAuth **Web application** client in Google Cloud. Its "Authorized JavaScript origin" is `https://avgrobo999.github.io`. Put the client ID (public, not a secret) in `GOOGLE_CLIENT_ID` in `js/auth.js`. Until then, rooms stay disabled and the rest of the app works normally.

For focus-log sync, in the same Google Cloud project: enable the **Google Drive API**, and on the OAuth consent screen add the `.../auth/drive.appdata` scope ("See, create, and delete its own configuration data in your Google Drive"). While the consent screen is in *Testing*, only the test users listed there can sign in, so publish it to let anyone use sync.

## Run locally

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

Keyboard shortcuts: `Space` start/pause · `R` reset · `N` skip · `1 2 3` modes · `T` tasks · `S` sounds · `M` music · `B` themes · `G` room · `V` mute · `D` deafen (in a call) · `F` full screen · `Q` big quote.

## Credits

Icons from [Lucide](https://lucide.dev) (ISC). Fonts are Outfit and Instrument Serif (SIL OFL). Live nature themes are short clips hot-linked from [Mixkit](https://mixkit.co) (Mixkit Stock Video Free License). Music presets embed Lofi Girl's YouTube live streams and Spotify playlists. Inspired by the layout of focus dashboards like Flocus, but all code, scenes and sounds are original.
