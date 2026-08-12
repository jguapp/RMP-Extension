# Raw captures

Drop real Schedule Builder screenshots here as `.png`, then run:

```bash
npm run screenshots -- --raw
```

Each one is reframed to exactly 1280x800 (the size the Chrome Web Store
requires) and written to `docs/store/`, keeping its filename.

Schedule Builder sits behind a CUNY login, so these cannot be generated —
they have to be captured by hand while signed in.

## Capturing well

- Maximise the browser and capture the **page area**, not the whole desktop.
  Anything wider than 1280x800 is cropped from the bottom, so keep the
  interesting part high in the frame.
- Capture at 1280x800 or larger. Smaller images get upscaled and look soft;
  the script warns when that would happen.
- Wait for the badges to finish loading — no spinners in the shot.
- One shot with the hover card open is worth more than three without it.

## Before you publish them

These show real professors' names next to real ratings, in a public listing
used to advertise a product. A red 2.1 beside a named person is a different
thing in a store listing than it is on their own RMP page. Prefer a view where
the visible professors are well rated, or blur the names — the extension is
what you are selling, not anyone's score.
