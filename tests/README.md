# Tests

## Behaviour specs (`tests/spec/*.json`)

What the app must do, written as data rather than code, so it outlives any one implementation.
Each file has an `about` describing its inputs and outputs, then `cases`, each with a `name`
saying what it pins down. A case's name says when it records a known limitation rather than the
behaviour we want.

| File | What it covers |
| --- | --- |
| `sentences.json` | Splitting text into the pieces read aloud (abbreviations, ellipses, long sentences) |
| `word-span.json` | Which characters of a word are highlighted; punctuation-only "words" aren't |
| `align.json` | Word timings from the voice model's output, recorded from Kokoro so no model is needed |
| `stretch.json` | Speeding speech up or down: same pitch, right length, no clicks, fast enough |
| `page-keys.json` | Which keys turn the page, and when they're left to the control they were pressed on |
| `position.json` | Stories of reading across devices: what gets saved, what's offered, wrong clocks, sleeping tabs |

`npm test` runs them against the TypeScript code (`spec.test.mjs` is the only TypeScript-specific
part). They run before every deploy; a failure stops it. Another implementation (a Rust rewrite,
say) needs only its own small runner that reads the same files.

Adding a case: when fixing a bug, add the input that showed it and the output it should have
given, and check the case fails without the fix.

To record new `align.json` input from the model, run `tts.generate` in a browser page with the
model call wrapped to keep `input_ids` and `durations` (as `kokoro.worker.ts` does), and save
each token's decoded phoneme, its duration and the audio length.
