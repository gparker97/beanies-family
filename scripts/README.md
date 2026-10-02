# Scripts

## Airport List Update (`updateAirports.mjs`)

Regenerates `src/constants/airports.ts` from [OurAirports](https://ourairports.com/data/) (public domain).

### Usage

```bash
npm run update-airports
```

### What It Does

1. **Fetches** the latest `airports.csv` from the OurAirports GitHub mirror
2. **Filters** to airports with `scheduled_service=yes` AND a valid 3-letter IATA code (~4,200 entries — covers every commercial airport globally; excludes general-aviation strips without scheduled flights)
3. **Cleans** names ("Singapore Changi Airport" → "Singapore Changi") and strips parenthetical suburb annotations from cities ("Sydney (Mascot)" → "Sydney")
4. **Renders** TypeScript matching the existing `AirportInfo` shape, plus an optional `country` field (ISO alpha-2)
5. **Runs Prettier** on the output so the diff stays clean
6. **Skips** writing if the regenerated content is identical to what's on disk (idempotent — CI uses this to decide whether to open a PR)

### Why scheduled-service-only

Going broader (all IATA-coded airports including GA fields like TOA Torrance) would balloon the list to ~9,000 entries / ~600 KB. The combobox already has an **Other** entry for the rare GA case. Scheduled-service is the right cut for a family travel planner.

### Automated Pipeline

`.github/workflows/airport-sync.yml` runs the script on the 1st of each month at 04:00 UTC. If the airport list changed, it pushes a branch and opens a PR for review.

### Adjusting the Filter

The inclusion rule is in `parseAirports()` inside the script. To change it (e.g. add general-aviation airports), edit the `if (sched !== 'yes') continue;` line.
