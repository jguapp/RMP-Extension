# Raw captures

Schedule Builder sits behind a CUNY login, so the screenshots that show a real
schedule cannot be generated — they have to be captured by hand while signed
in. Drop them here, then run:

```bash
npm run screenshots -- --raw
```

Each image is reframed to exactly 1280x800 (the size the Chrome Web Store
requires) and written to `docs/store/`, keeping its filename.

## Filenames

Use these, so the README's hero image keeps resolving and the listing stays in
a sensible order:

| Save as | Should show |
| --- | --- |
| `1-hover-preview.png` | The hover card open over a class — the feature worth selling |
| `2-schedule-builder.png` | The full Schedule Builder with badges down the results list |

`3-popup.png` is rendered by `npm run screenshots` and needs no capture: the
popup contains no professor data, so a rendered one is identical to a real one.

## Capturing well

- Maximise the browser and capture the **page area**, not the whole desktop.
  Anything wider than 1280x800 is cropped from the bottom, so keep the
  interesting part high in the frame.
- Capture at 1280x800 or larger. Smaller images get upscaled and look soft;
  the script warns when that would happen.
- Wait for every badge to finish loading — no spinners in the shot.

## Before you publish them

**Crop out your own name.** Schedule Builder puts the signed-in student's name
in the top-right of the header. That is fine on your screen and not fine in a
public store listing.

**Think about whose ratings are on show.** These are real professors, named,
next to real scores and tags, in an image advertising a product. A low score or
a "Tough grader" tag reads differently in your promotional material than it
does on that professor's own RMP page. Prefer a view where the visible
professors are well rated, or blur the names — the extension is what you are
selling, not anyone's score.

## How the reframe crops

Overflow is taken off the **right and bottom**, never the sides evenly. A
centred crop slices the leftmost panel down the middle and leaves half-words
along the edge, which reads as a broken image rather than a cropped one. So
keep anything essential toward the top-left of the capture.
