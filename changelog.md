# Changelog

All notable changes to this project are documented in this file.
Also update package.json on changes.

- **Version Increment Rule:** Increment by 0.0.1 (patch version) with every prompt/interaction
- **Format:** MAJOR.MINOR.PATCH (e.g., 0.5.6, 0.5.7, 0.6.0)

Increment the Version for **each** change, not only for commits.

## [1.1.0] - 2026-03-27

### Changed
- Added `calendar-public.json` generation in `scripts/sync-events.mjs` so frontend fallback URLs come from the same calendar source config.
- Updated `events.js` to read `calendar-public.json` before loading `events-data.json`, with safe hardcoded fallback when unavailable.
- Updated GitHub Actions workflows to preserve and commit `calendar-public.json` on the `live` branch.
- Fixed README calendar sync schedule text to 30 minutes and documented the new generated calendar config file.
- Added a new `# commit rules` section to `README.md` documenting clean commit expectations (changelog/version discipline, static-first architecture, minimal dependencies, GDPR-lean data sourcing, and verification).
- Aligned `package.json` version to `1.1.0`.
