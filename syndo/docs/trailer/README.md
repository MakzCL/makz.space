# SEND trailer

A 50 second, 1080p trailer rendered frame by frame from `index.html` + `trailer.ts`, using the real SEND Motion engine.

1. Capture app shots into `shots/` (chat, profile, studio, theme-neon, theme-paper, theme-terminal, theme-aurora) and copy `send-wordmark-white.svg` and `CabinetGrotesk-Family.woff2` into `assets/`.
2. Bundle: `esbuild trailer.ts --bundle --outfile=trailer.js --alias:@send/shared=../../shared/src/index.ts` (fix the absolute engine import paths if needed).
3. Music: `python3 music.py music.wav`
4. Frames: `node render.cjs all frames` (JPEG frames)
5. Encode: `ffmpeg -framerate 30 -i frames/f_%05d.jpg -i music.wav -c:v libx264 -crf 18 -pix_fmt yuv420p -vf scale=1920:1080 -c:a aac -shortest SEND-trailer.mp4`
