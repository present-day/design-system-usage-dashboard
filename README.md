# Design System Usage Dashboard

Measures how much of your Figma work comes from your design system, and publishes the trend as a static dashboard on GitHub Pages.

**Live demo with sample data:** https://present-day.github.io/design-system-usage-dashboard/

It answers four questions, per team and over time:

- What share of color, spacing, radius and type values are bound to a variable or style, and what share are typed in by hand?
- What share of component instances come from the design system library?
- Which published components are used most, and which are never used?
- Which raw values keep recurring, and is there a token that already covers them?

Each component also has a detail view: instances over time, which variants people reach for, how many instances carry a visual override, which teams use it, and the pages where it appears most.

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
3. **Optionally add a repository variable** named `FIGMA_TOKEN_EXPIRES_ON` with the expiry date, such as `2027-01-18`. The dashboard shows how many days the token has left in a banner at the top, which turns into a warning three weeks before that date. Another variable, `FIGMA_REQUESTS_PER_MINUTE`, sets the request pace (see [Rate limits](#rate-limits)).
4. **Edit `dashboard.config.json`:**

   ```json
   {
     "library": { "fileKey": "AbC123libraryFileKey" },
     "tokensFile": "tokens.json",
     "ignorePages": ["archive", "scratch"],
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
| `ignorePages` | No | Page names to skip, matched as case-insensitive substrings. Also accepted on a single file entry. |
| `figmaTokenExpiresOn` | No | Same as the `FIGMA_TOKEN_EXPIRES_ON` variable, which takes precedence. |

## Import Figma library analytics

On plans that include library analytics, Figma reports how often each library component is inserted, detached and used, by team and by file. That covers adoption without reading any files, so it is a fast way to fill the dashboard before the collector is set up.

1. Export the library's analytics as CSV, using Figma's names for the groupings: `usages_by_component.csv`, `usages_by_file.csv`, `actions_by_component.csv` and `actions_by_team.csv`.
   Add `variable_actions_by_variable.csv` and `variable_actions_by_team.csv` to also import how often tokens (variables) are applied and detached.
2. Run `npm run import-analytics -- path/to/export`. It writes one snapshot per week to `site/data/`, or to a folder given as a second argument.

What changes on the dashboard:

- **Library instances by team** replaces the token-coverage chart, and component pages show the latest week's detachments and insertions.
- **Tokens applied and detached** appears when the variable exports are included: a weekly total with detachments per 1,000 applications, the most-detached tokens, and detachments by team. A detachment is a token replaced by a typed-in value, so the most-detached tokens point to where the system does not fit.
- **Token coverage, raw values, instances from other libraries and page detail show as "Not measured".** They need a file read, which only the collector does.
- **Weeks before the latest are estimated.** Usage is only exported as current totals, so each earlier week is current usage minus later insertions plus later detachments. Instances deleted outright are missed.

Analytics exports name your teams, people's drafts and files. If the repository is public, keep imported snapshots out of it.

## Large and untidy files

The collector never downloads a whole file in one request. It lists the pages first, then reads top-level layers 25 at a time across pages, so file size affects how long a run takes and not whether it finishes.

### Rate limits

Figma limits how many file reads a token's account can make, not how many bytes it downloads ([Figma rate limits](https://developers.figma.com/docs/rest-api/rate-limits)). Reading file content is in Figma's strictest tier:

- **Full and Dev seats** get 10 to 20 requests a minute depending on the plan. Use an account with one of these seats.
- **View and Collab seats** get about 6 requests a month, which is too few for even one run.

The collector spaces its requests to stay under the limit instead of waiting for Figma to refuse them. It defaults to 10 a minute, the lowest paid-seat limit. Set the repository variable `FIGMA_REQUESTS_PER_MINUTE` to your plan's limit to finish sooner, or to `0` to turn pacing off.

`npm run scale-test` measures this without a Figma account. It runs the collector against a local mock of the Figma API serving five synthetic files, sized like the five busiest files in a real 174-file library rollout (23,000 instances in all). That run makes 78 requests and downloads about 128 MB, which takes about 8 minutes at 10 requests a minute. Every additional file of similar size adds requests in proportion.

Untidy files are expected, and the dashboard is built to show where the mess is:

- **Pages with the most raw values** ranks every page by hand-typed values, so cleanup can start where it pays off most.
- **`ignorePages`** keeps archives, scratch pages and old explorations out of the numbers once a team agrees they should not count.
- **Hidden layers are skipped**, so abandoned work that someone hid does not drag coverage down.

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
- **Restyled instance:** a library instance with an override on a visual property such as fill, stroke, radius, spacing or type. Text and visibility changes do not count.

Values inside an instance are skipped, because they belong to the library component and not to the file's author. Hidden layers are skipped.

## Limits

- **Detached components are invisible.** Once detached they are plain frames. Figma's own library analytics reports detaches on plans that include it.
- **Gradients, effects, mixed corner radii and line height are not counted yet.**
- **The collector has been tested against fixtures and a mock of Figma's API, not yet against a live file.** Expect to adjust it on first contact with real data.
- **A batch of large top-level frames** is still read in one request. If one times out, split the frames in Figma or lower `NODES_PER_REQUEST` in `collector/figma.mjs`.
- **Snapshots keep the top 50 components, 30 pages and 25 raw values**, not every one.

## Develop locally

Requires Node 20 or newer. There are no dependencies to install.

```sh
npm test                      # collector tests
npm run scale-test            # collector against a large mock Figma API
npm run import-analytics -- path/to/export   # snapshots from a library analytics CSV export
npm run sample                # regenerate site/sample-data
npm run serve                 # dashboard at http://localhost:4173
FIGMA_TOKEN=... npm run collect   # write a real snapshot to site/data
```

## License

MIT
