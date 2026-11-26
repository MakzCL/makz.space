# SEND showcase (narrated)

A 2 minute 18 second narrated walkthrough of SEND, rendered frame by frame with the real SEND Motion engine, in the same style as `../trailer`.

- Narration: ElevenLabs, voice "George", model `eleven_multilingual_v2`, lines in `script.json` (one clip per scene).
- `timeline.json` / `tl.ts`: scene start and end times, taken from each line's length (lead-in + line + tail).
- App shots: `capture.cjs` drives a local SEND (fake camera for the call) and saves `img/*.png`.
- Music: `python3 music2.py music.wav timeline.json` (synthesised, hits on scene cuts, softer under the voice).

Build:
1. `npx esbuild showcase.ts --bundle --outfile=showcase.js --alias:@send/shared=../../shared/src/index.ts`
2. Frames, in parallel chunks that start on scene boundaries: `node render2.cjs <from> <to> frames`
3. Voice track: place each clip at its `vo` time, duck the music under it, loudnorm to -14 LUFS (see the ffmpeg in the session notes).
4. `ffmpeg -framerate 30 -i frames/f_%05d.jpg -i mix.wav -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -vf scale=1920:1080 -c:a aac -b:a 192k -shortest SEND-showcase.mp4`
