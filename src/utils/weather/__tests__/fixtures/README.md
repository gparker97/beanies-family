# Open-Meteo fixtures

- Source: `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=<zone>&forecast_days=5` and `https://geocoding-api.open-meteo.com/v1/search?name=<query>&count=6&language=en[&countryCode=US]` (free endpoints, no key).
- Captured 2026-10-16 with curl, unmodified apart from pretty-printing.
- Data by Open-Meteo.com, licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
