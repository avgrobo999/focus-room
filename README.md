# focusroom

A calm, aesthetic focus dashboard: a big clock, a Pomodoro timer, tasks, ambient sounds and animated scenes, plus a **private study room for you and one friend**.

**Live:** https://avgrobo999.github.io/focus-room/

## Features

- **Three modes:** Home (clock, greeting, today's focus, quote), Focus (timer + current task) and Ambient (just the scene, with a small timer in the corner)
- **Timer:** Pomodoro with presets (25/5, 50/10, Animedoro 40/20, 15/3, custom), countdown or stopwatch. Auto-start options, session tally, alert sounds and desktop notifications
- **Tasks:** your top unfinished task becomes your current focus. Drag to reorder and estimate sessions per task
- **Ambient sounds:** 18 layerable sounds synthesized live in the browser (rain, thunder, wind, waves, stream, campfire, birds, crickets, typing, clock, white/pink/brown noise, binaural beats), plus one-click soundscapes
- **Music:** built-in lofi/synthwave streams and Spotify playlists, or paste any YouTube or Spotify link
- **Themes:** 8 animated canvas scenes, photo backgrounds, or upload your own
- **Stats:** today, last 7 days, streak, monthly and all-time focus time, recent sessions
- **Study room (2 people):**
  - Create a room, sign in with Google, and send the invite link. It's end-to-end encrypted
  - Timers can be synced: start, pause and skip together
  - See what your friend is working on and how long they have left
  - Chat, emoji reactions and theme sharing
  - Either person can drop out and rejoin. A third visitor sees "room full"

## How the room is secured

- **Sign in with Google (rooms only).** Both people sign in with [Google Identity Services](https://developers.google.com/identity/gsi/web). Each browser checks the *other* person's ID token itself: Google's RS256 signature, issuer, audience (this app's client ID), expiry, verified email, and a nonce tied to this one room, so a token can't be reused in any other room or app. You can also **lock a room** to one Google account.
- **End-to-end encryption.** The invite link looks like `…/focus-room/#r=<code>.<secret>`. The 128-bit secret lives in the URL fragment, which browsers never send to a server. Every message is sealed with AES-256-GCM using a key derived from it with HKDF. A challenge/response handshake proves the other side holds the key, and sequence numbers block replays. That keeps GitHub, the PeerJS broker and any relay out: they can't read or forge room traffic.
- **No server of our own.** The public [PeerJS](https://peerjs.com) broker only introduces the two browsers. After that, traffic flows directly over WebRTC. Nothing is stored server-side.
- **Hardening:**
  - Strict Content-Security-Policy, and the app refuses to run inside a frame.
  - Strict validation and rate-limiting of everything a friend sends.
  - Focus stats only credit time that really passed on your own device.
  - Test hooks only work on `localhost`.
- **Still true:** a direct peer-to-peer connection lets each browser learn the other's IP address. Only share invites with people you trust.

### Setup: Google client ID

Create an OAuth **Web application** client in Google Cloud. Its "Authorized JavaScript origin" is `https://avgrobo999.github.io`. Put the client ID (public, not a secret) in `GOOGLE_CLIENT_ID` in `js/auth.js`. Until then, rooms stay disabled and the rest of the app works normally.

## Run locally

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

Keyboard shortcuts: `Space` start/pause · `R` reset · `N` skip · `1 2 3` modes · `T` tasks · `S` sounds · `M` music · `B` themes · `G` room · `F` full screen.

## Credits

Icons from [Lucide](https://lucide.dev) (ISC). Fonts are Outfit and Instrument Serif (SIL OFL). Photo themes are hot-linked from [Unsplash](https://unsplash.com) (Unsplash License). Music presets embed Lofi Girl's YouTube live streams and Spotify playlists. Inspired by the layout of focus dashboards like Flocus, but all code, scenes and sounds are original.
