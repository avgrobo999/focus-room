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
  - Create a room, send the link, and you're connected peer-to-peer
  - Timers can be synced: start, pause and skip together
  - See what your friend is working on and how long they have left
  - Chat, emoji reactions and theme sharing
  - Either person can drop out and rejoin. A third visitor sees "room full"

## How the room works

There's no backend. [PeerJS](https://peerjs.com) (vendored in `vendor/`) uses the free public PeerJS broker only to introduce the two browsers. After that, everything flows directly between them over WebRTC, and nothing is stored on a server. The room code maps to a fixed peer ID. Whoever arrives first holds it and the other connects to them; if that person leaves, the other takes over the ID.

## Run locally

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

Keyboard shortcuts: `Space` start/pause · `R` reset · `N` skip · `1 2 3` modes · `T` tasks · `S` sounds · `M` music · `B` themes · `G` room · `F` full screen.

## Credits

Icons from [Lucide](https://lucide.dev) (ISC). Fonts are Outfit and Instrument Serif (SIL OFL). Photo themes come from [Lorem Picsum](https://picsum.photos) (Unsplash photos). Inspired by the layout of focus dashboards like Flocus, but all code, scenes and sounds are original.
