# Trainer

A small PWA that generates structured indoor-cycling workouts from your FTP and exports them as Garmin `.fit` workout files for the Edge 530 (or any Edge that supports structured workouts + smart-trainer control).

- Pick a type (Recovery, Endurance, Tempo, Sweet Spot, Threshold, VO2max, Anaerobic), a duration and a difficulty → get a workout with warm-up, main set and cool-down. Hit ↻ for another variation.
- "Suggested for today" proposes a workout from your recent history (easy after hard days, rotates quality sessions, progresses difficulty).
- Works offline; everything is stored in your browser (localStorage).

## Load a workout on the Edge 530

1. Download the `.fit` file.
2. Connect the Edge via USB and copy the file into `Garmin/NewFiles`.
3. Unplug. On the Edge: **Training → Workouts**, select it, ride. With the trainer paired as a Smart Trainer (ANT+ FE-C) the Edge drives ERG mode.

Settings → *Power targets in file*: **absolute watts** (uses the FTP set in the app) or **% of FTP** (uses the FTP stored on the Edge).

## Develop

No build step — plain ES modules.

```bash
npm start      # serves on http://localhost:8080
npm test       # generator + FIT encoder tests
```

Deploy by enabling GitHub Pages on the `main` branch (root).
