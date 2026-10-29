# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `banner_academic_periods_get`: `title` (every word must appear, case-insensitive, e.g.
  "fall 2026") and `currentAndUpcoming` (terms not yet ended, soonest first), so a term name
  resolves to its code in one call; results include the period `category`.
- `banner_sections_search`: `subject` (e.g. "BIOL") and `courseNumber`, resolved server-side to
  catalog courses, so "which sections of BIOL run in 202680?" is answerable in one call.
- `banner_student_context` with `academicPeriodCode` echoes `requestedTerm`,
  `registrationRowsInRequestedTerm` and `registeredInRequestedTerm`.
- `BANNER_API_PATH_PREFIXES` (default `/StudentApi/api/,/BannerAdminBPAPI/api/`): the only
  paths `banner_api_get` may read.
- Dependency: `graphql` (reference parser for the read-only GraphQL check).

### Fixed

- A term code is resolved only on an exact `code` match. Previously, when the tenant ignored
  the criteria, the first academic period returned was used, so term-scoped tools could answer
  for the wrong term.
- `banner_person_lookup` and `banner_student_context` check Banner ID / email results
  server-side and drop rows that do not match (flagged `filterIgnored` with a warning), instead
  of reporting an unfiltered page of unrelated people as matches.
- `banner_student_context` reads up to 1000 registrations before sorting by recency (was 200,
  capped before sorting, so a long history could hide the newest terms), says so when the cap
  is hit, and never reports another term's rows when a term was requested.
- `banner_api_get` reads Banner's `X-hedtech-totalCount` / `X-hedtech-pageOffset` /
  `X-hedtech-pageMaxSize` (or `X-Total-Count`) headers instead of always reporting
  `offset: 0, hasMore: false`; without paging headers `hasMore` is `"unknown"`.
- Oversized HTTP request bodies get the documented `413` (with `Connection: close`) instead of
  a connection reset.

### Security

- `banner_ethos_graphql`: the mutation check is done by parsing the document with the
  `graphql` package; only query operations and fragments are allowed and unparseable documents
  are rejected. The previous regex check could be bypassed with a quote inside a `#` comment.
- `banner_api_get` no longer sends the Banner service account's credentials to arbitrary paths
  on the host (admin consoles, UI pages); see `BANNER_API_PATH_PREFIXES`.
- Audit log: emails and Banner IDs are redacted wherever they appear (array elements, unknown
  keys); generic `criteria` and object payloads are logged as key structure only; identity
  document keys are redacted; string payloads use an HMAC with a per-process random key instead
  of an unkeyed, dictionary-reversible SHA-256; REST paths keep only the API base segments.

### Changed

- README: clone the SDK at `v0.2.0` (`main` lacks `filter`/`filterAll`/`namedQuery`); release
  ordering note (the `v0.2.0` SDK tag must exist before this README/CI are merged); Claude Code
  setup now recommends `.mcp.json` with `${ETHOS_API_KEY}`, warns that `claude mcp add -e`
  stores the literal key in `~/.claude.json`, and gives a PowerShell variant.

### Removed

- Unused `formatMcpError` / `wrapToolHandler` (tool errors go through `runTool` ->
  `describeError`); `isDomainName` is now used by config validation.

## [0.2.0] - 2026-10-27

### Added

- `banner_person_lookup`: find a person by Banner ID, email or name (Ethos `persons` criteria)
  and get the GUID plus a compact summary (no DOB/SSN/address/phone).
- `banner_student_context`: one-call student profile (person summary, student record, recent
  section registrations grouped by term with section and term titles).
- `banner_section_registrations_search`, `banner_sections_get`.
- Criteria parameters on existing search tools: persons (name, role), students (personId),
  sections (term code/GUID, code, number, courseId, keyword), academic periods (code),
  employees and jobs (personId).
- Optional `fields` projection on every get/search tool.
- Global response cap (`BANNER_MAX_RESPONSE_CHARS`, default 60000) with an explicit truncation
  notice; page results are trimmed to whole records and stay valid JSON. All output is compact
  JSON.
- Audit log: one JSON line per tool call on stderr with sanitized arguments (Banner IDs,
  emails, names, SSN, DOB, credentials, request bodies and GraphQL documents redacted),
  result count, duration and error. Response bodies are never logged.
- `banner_api_get`: read-only GET against native Banner REST APIs on the configured host,
  registered only when `BANNER_BASE_URL`, `BANNER_USERNAME` and `BANNER_PASSWORD` are set.
- HTTP transport: bearer-token auth (`BANNER_MCP_HTTP_TOKEN`, constant-time compare), per-session
  transports and servers keyed by `mcp-session-id`, session cleanup on DELETE/close/idle,
  `GET /healthz`, optional Host allow-list, session cap, 1 MB request body limit.
- `BANNER_PRELOAD_DOMAINS=all|none`.
- README, `.github/workflows/ci.yml` (Node 20/22), Dockerfile (node:22-alpine, non-root,
  HTTP transport), `.dockerignore`.

### Changed

- **Read-only by default.** `banner_ethos_create`, `banner_ethos_update`, `banner_ethos_delete`
  and `banner_ethos_consume_notifications` (which acknowledges queue messages) are only
  registered when `BANNER_ALLOW_WRITES=true`. `banner_status` reports `writesEnabled`.
- `banner_ethos_graphql` rejects mutation and subscription documents.
- HTTP transport binds `127.0.0.1` by default and refuses to start without a token.
- Domain tool names are derived from what each domain actually registers; the hard-coded
  `DOMAIN_TOOLS` list is gone. Each MCP server owns its own domain registry.
- `config.ts` validates every numeric, boolean and URL variable and fails with the variable
  name (never its value).
- Financial aid awards use the SDK's `studentFinancialAidAwards` accessor
  (`student-financial-aid-awards` v11).
- Requires Node.js 20 or later (eslint 10 and vitest 4 do).
- Depends on `ellucian-banner` 0.2.0 (sibling checkout, `file:../ellucian-banner`) and
  `@modelcontextprotocol/sdk` ^1.32.2 (fixes GHSA-46jr-4wx8-v453 and related advisories).

### Fixed

- A clean clone could not build: the SDK dependency pointed at a path that exists on no machine.
- Only one HTTP client session could ever work (single shared transport).

## [0.1.0]

- Initial scaffolding: MCP server with stdio/HTTP transports, domain registry, student,
  financial aid, finance, HR and Ethos domains.
