# Design System Usage Dashboard

Measures how much of your Figma work comes from your design system, and publishes the trend as a static dashboard on GitHub Pages.

**Live demo with sample data:** https://present-day.github.io/design-system-usage-dashboard/

It answers four questions, per team and over time:

- What share of color, spacing, radius and type values are bound to a variable or style, and what share are typed in by hand?
- What share of component instances come from the design system library?
- Which published components are used most, and which are never used?
- Which raw values keep recurring, and is there a token that already covers them?

No server, database or MCP access is involved. A scheduled GitHub Actions job reads Figma's REST API, commits a small JSON snapshot, and redeploys a static page.

## How it works

```
Figma REST API ──> collector/ ──> site/data/snapshots/YYYY-MM-DD.json ──> site/index.html
                   (nightly)       (committed to the repo)                 (GitHub Pages)
```

- `collector/` reads each registered file, counts instances and values, and writes one snapshot per run.
- `site/` is the dashboard. It reads the snapshots in `site/data/`. When there are none, it falls back to `site/sample-data/` and says so on the page.
- `.github/workflows/dashboard.yml` runs the tests, runs the collector, commits the snapshot and deploys the page. It runs nightly, on every push to `main`, and on demand.

Snapshots hold counts, component names and raw values such as `#1A4B8C` or `14px`. They hold no frames, text or images from the files.

## Run it on your own files

1. **Create a Figma access token** with read access to file content and to published library content. Figma names these scopes `file_content:read` and `library_content:read`; check Figma's scope documentation if a request is refused. Use an account that can view every file you list, ideally a shared account and not a personal one.
2. **Add the token as a repository secret** named `FIGMA_TOKEN`.
3. **Optionally add a repository variable** named `FIGMA_TOKEN_EXPIRES_ON` with the expiry date, such as `2027-01-18`. The dashboard warns for three weeks before that date.
4. **Edit `dashboard.config.json`:**

   ```json
   {
     "library": { "fileKey": "AbC123libraryFileKey" },
     "tokensFile": "tokens.json",
     "teams": [
       {
         "id": "web-app",
         "name": "Web app",
         "files": [{ "key": "XyZ789fileKey", "name": "Checkout flows" }]
       }
     ]
   }
   ```

   A file key is the part of a Figma URL after `/design/` or `/file/`.

5. **Enable GitHub Pages** with the source set to GitHub Actions, then run the workflow.

### Configuration

| Field | Required | What it does |
|---|---|---|
| `teams[].files[].key` | Yes | The Figma files to measure, grouped by team. |
| `library.fileKey` | No | The design system's library file. With it, an instance counts as a library instance only when that file published its component, and unused components can be listed. Without it, any component from any library counts. |
| `tokensFile` | No | Path to a token file in the [Design Tokens Community Group format](https://www.designtokens.org). With it, each recurring raw value is matched to its nearest token as exact, near or no match. |
| `figmaTokenExpiresOn` | No | Same as the `FIGMA_TOKEN_EXPIRES_ON` variable, which takes precedence. |

## Token rotation

Figma personal access tokens expire after at most 90 days, so the token is the one part that needs attention.

- Replace the `FIGMA_TOKEN` secret and update `FIGMA_TOKEN_EXPIRES_ON` when you rotate.
- If the token lapses, the run fails and the dashboard keeps its last snapshot. The "data as of" date at the top shows how old the numbers are.
- For a version that never needs rotating by hand, register a Figma OAuth app and exchange a refresh token for an access token at the start of each run.

## What is counted

- **Library instance:** an `INSTANCE` node whose main component is published by the library file.
- **Bound value:** a solid fill or stroke, an auto-layout gap or padding, a corner radius, or a text size that references a variable or a style.
- **Raw value:** the same properties holding a literal.
- **Token coverage:** bound values divided by bound plus raw values.

Values inside an instance are skipped, because they belong to the library component and not to the file's author. Hidden layers are skipped.

## Limits

- **Detached components are invisible.** Once detached they are plain frames. Figma's own library analytics reports detaches on plans that include it.
- **Gradients, effects, mixed corner radii and line height are not counted yet.**
- **The collector has been tested against fixtures shaped like Figma's file response, not yet against a live file.** Expect to adjust it on first contact with real data.
- **Very large files** come back as one large response. If a file times out, split the list by page with the API's `ids` parameter.

## Develop locally

Requires Node 20 or newer. There are no dependencies to install.

```sh
npm test                      # collector tests
npm run sample                # regenerate site/sample-data
npm run serve                 # dashboard at http://localhost:4173
FIGMA_TOKEN=... npm run collect   # write a real snapshot to site/data
```

## License

MIT
