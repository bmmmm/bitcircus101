# Changelog

## Unreleased

- **Footer funding popover:** Fixed stacking so the funding info panel sits above page content and receives clicks (`opacity` on `.footer__status` was creating a stacking context that trapped `z-index`; replaced with `rgba` text colors and explicit `pointer-events` on the panel).
- **Navigation:** Aligned sticky header row height between the `bitcircus101` brand link and the menu button (`min-height` / padding shared with `nav li a`; mobile uses 44px to match touch targets).
- **Layout partials:** Shared site header and footer live in `includes/site-header.html` and `includes/site-footer.html`. Run `npm run build:layout` (or `node scripts/inject-layout.mjs`) to apply them to all six layout pages. Deploy reapplies partials before cache-busting; CI on PR and on push to `main` fails if committed HTML drifts from the partials.
- **Docs:** [CONTRIBUTING.md](CONTRIBUTING.md), [CLAUDE.md](CLAUDE.md), and [README.md](README.md) describe the layout workflow; PR checks ([`ci.yml`](.github/workflows/ci.yml)) run the layout sync check plus unit tests.
