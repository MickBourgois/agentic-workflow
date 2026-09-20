# Presentation website

The French website combines a presentation page, an interactive routing example,
and seven documentation pages. Its build imports `VERSION`, the real model
routes, and delivery defaults from the workflow. The website is not part of the
consumer install payload.

## Local preview

From the repository root, using Node.js 20+:

```bash
npm run site:dev
```

Open `http://127.0.0.1:4173`. The server builds the site when it starts; restart it
after editing source files. Override the port with `PORT=4180 npm run site:dev`.
The preview server binds only to localhost. It is not a production server.

## Build and deploy

```bash
npm run site:build
```

The output directory is `website/dist/`. Serve it with any static host using
directory indexes. There is no framework, package dependency, client-side router,
analytics, or external font request.

For a project hosted below a URL prefix:

```bash
SITE_BASE_PATH=/agentic-workflow SITE_URL=https://example.com npm run site:build
```

`SITE_URL` is the origin, without a trailing slash; `SITE_BASE_PATH` is the path
prefix. Providing an origin generates canonical tags and a sitemap. `robots.txt`
is always generated. Social metadata includes an SVG preview; some social
platforms require a PNG instead, so convert that illustration before relying on
link cards for a launch.

On Vercel, use build command `npm run site:build` and output directory
`website/dist`. GitHub Pages also supports these static files; build with the
repository base path. Publishing remains an explicit separate operation.

## Source files

- `home.mjs`: presentation, interactive routes, and skill catalog.
- `docs.mjs`: French documentation and canonical source links.
- `ui.mjs`: shared layout, icons, escaping, and code blocks.
- `assets/`: local styles, progressive interactions, and vector identity.
- `build.mjs`: static page generation from canonical workflow data.
- `server.mjs`: localhost preview.
- `tests/build.test.mjs`: links, anchors, path prefixes, version and route data.

Update explanatory content when changing the corresponding workflow contract.
Source links point at the canonical files; model routes and version are generated
automatically.

## Validation

```bash
npm run site:test
npm run site:build
```

The root `npm run check` includes these checks. The browser interactions support
keyboard-operated risk tabs, a mobile menu, native FAQ disclosures, and copy
buttons with a selection fallback. Reduced-motion preferences are respected.
