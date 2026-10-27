# banner-mcp-server

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI assistants
(Claude Code, Claude Desktop, or any MCP client) **read-only** access to Ellucian Banner through
**Ethos Integration**, plus optional native Banner REST APIs. Built on the
[`ellucian-banner`](https://github.com/chatt-state/ellucian-banner) SDK.

It answers questions like "find student A00123456", "what is the term code for Fall 2026?",
"what is Ada Lovelace registered for this term?", or "which sections of BIOL run in 202680?"
without the model paging through whole collections.

> **FERPA.** Everything this server returns is student or employee education-record data.
> Run it only for staff with a legitimate educational interest, keep it read-only unless you
> have a reviewed need for writes, and keep the audit log. See [Security model](#security-and-ferpa-model).

## Contents

- [Install](#install)
- [Tools](#tools)
- [Configuration](#configuration)
- [Claude Code setup](#claude-code-setup)
- [HTTP deployment](#http-deployment)
- [Security and FERPA model](#security-and-ferpa-model)
- [Ethos API key setup](#ethos-api-key-setup)
- [Development](#development)

## Install

Requires **Node.js 20 or later**.

The SDK dependency is currently a sibling checkout, so clone both repositories side by side:

```bash
git clone -b v0.2.0 https://github.com/chatt-state/ellucian-banner.git
git clone https://github.com/chatt-state/banner-mcp-server.git
cd ellucian-banner && npm ci && cd ..      # builds the SDK (prepare script)
cd banner-mcp-server && npm ci && npm run build
```

Clone the SDK at **v0.2.0**, not `main`: this server uses `filter`, `filterAll` and
`namedQuery`, which `main` (0.1.0) does not have, so a `main` checkout fails to build.

> **Release ordering.** The `v0.2.0` tag must be created on the `ellucian-banner` commit that
> contains its `improve/production-ready` changes *before* this README and the CI workflow
> (`ELLUCIAN_BANNER_REF: v0.2.0`) are merged. Until the tag exists, clone that branch instead:
> `git clone -b improve/production-ready https://github.com/chatt-state/ellucian-banner.git`.

`package.json` has `"ellucian-banner": "file:../ellucian-banner"` for now. **The canonical
dependency is `github:chatt-state/ellucian-banner#v0.2.0`**; once `package.json` uses that,
`npm ci` alone fetches and builds the SDK (git must be installed) and the sibling checkout is
no longer needed.

## Tools

The server starts with two navigator tools and the domains listed in `BANNER_PRELOAD_DOMAINS`
(default `student`). `banner_navigate` loads more domains at runtime and notifies the client
(`tools/list_changed`). Clients that ignore that notification (some web portals) should use
`BANNER_PRELOAD_DOMAINS=all`.

Every get/search tool accepts an optional `fields` projection (dot paths such as
`["names.lastName","credentials"]`; `id` is always kept). All search tools take `offset`/`limit`
and return `{totalCount, offset, count, hasMore, nextOffset, data}`.

| Tool | Domain | What it does |
| --- | --- | --- |
| `banner_navigate` | core | Load a domain tool set |
| `banner_status` | core | Version, loaded domains and tools, `writesEnabled`, configured back ends |
| `banner_api_get` | core | Read-only GET under the allowed Banner REST API prefixes (`BANNER_API_PATH_PREFIXES`) on the configured host; list results report Banner's `X-hedtech-*` paging headers (only when `BANNER_BASE_URL`/`USERNAME`/`PASSWORD` are set) |
| `banner_person_lookup` | student | Banner ID, email or name -> person GUID + compact summary. Banner ID/email results are checked server-side; rows that do not match are dropped and flagged `filterIgnored` |
| `banner_student_context` | student | Banner ID or person GUID -> person summary, student record, recent registrations by term with section/term titles. With `academicPeriodCode` it echoes `requestedTerm` and `registeredInRequestedTerm` |
| `banner_persons_search` / `_get` | student | persons v12; search by lastName/firstName/role |
| `banner_students_search` / `_get` | student | students v16; search by personId |
| `banner_courses_get` | student | courses v6 |
| `banner_sections_search` / `_get` | student | sections v16; by term code/GUID, section code, number, courseId, **subject** (+ `courseNumber`, e.g. `BIOL` / `1110`), or keyword |
| `banner_section_registrations_search` | student | section-registrations v16 by registrant, section and/or term (a filter is required) |
| `banner_academic_periods_get` | student | academic-periods v16; find terms by `title` words ("fall 2026"), `currentAndUpcoming`, or exact term `code` (`202680`) |
| `banner_financial_aid_applications_search` / `_get` | financial_aid | financial-aid-applications v9 |
| `banner_financial_aid_awards_search` / `_get` | financial_aid | student-financial-aid-awards v11 |
| `banner_accounting_strings_search` / `_get` | finance | accounting-strings v7 |
| `banner_ledger_activities_search` / `_get` | finance | ledger-activities |
| `banner_employees_search` / `_get` | hr | employees v12; search by personId |
| `banner_positions_search` / `_get` | hr | institution-positions v12 |
| `banner_jobs_search` / `_get` | hr | institution-jobs v12; search by personId |
| `banner_ethos_get`, `banner_ethos_get_all` | ethos | Any EEDM resource by name (and GUID) |
| `banner_ethos_filter` | ethos | Any resource with an Ethos `criteria` object |
| `banner_ethos_qapi_search` | ethos | QAPI (`POST /qapi/{resource}`) search |
| `banner_ethos_graphql` | ethos | GraphQL **queries** (mutations/subscriptions rejected) |
| `banner_ethos_create` / `_update` / `_delete` | ethos | **Writes. Only registered when `BANNER_ALLOW_WRITES=true`** |
| `banner_ethos_consume_notifications` | ethos | **Acknowledges queue messages. Only when `BANNER_ALLOW_WRITES=true`** |

### Search criteria

Lookups and filters use Ethos `?criteria=` JSON:

| Purpose | Resource | Criteria |
| --- | --- | --- |
| Person by Banner ID | persons v12 | `{"credentials":[{"type":"bannerId","value":"A00123456"}]}` |
| Person by email | persons v12 | `{"emails":[{"address":"ada@example.edu"}]}` |
| Person by name | persons v12 | `{"names":[{"firstName":"Ada","lastName":"Lovelace"}]}` |
| Student record of a person | students v16 | `{"person":{"id":"<person guid>"}}` |
| Term by code | academic-periods v16 | `{"code":"202680"}` |
| Sections in a term | sections v16 | `{"academicPeriod":{"id":"<term guid>"}}` (+ `code`, `number`, `course`) |
| Registrations of a student | section-registrations v16 | `{"registrant":{"id":"<person guid>"}}` (+ `section`, `academicPeriod`) |
| Employee/jobs of a person | employees v12, institution-jobs v12 | `{"person":{"id":"<person guid>"}}` |

Term codes are never guessed: `academicPeriodCode` must match a term's `code` exactly, or the
tool fails instead of answering for another term. Use `banner_academic_periods_get` with
`title` or `currentAndUpcoming` to find the code.

The Banner ID, term-code and registrant/term shapes are the ones the `ellucian-banner` SDK
documents and tests. Which other filters a resource honors, and whether name/email matching is
exact or case-insensitive, depends on the Banner Ethos API version installed at your
institution; an unsupported filter is usually rejected with HTTP 400 or silently ignored. The
tool descriptions say so, so the model checks results. Verify against your tenant's API
documentation (Ethos Integration > API documentation for each resource) before relying on a
filter.

### Output limits

Responses are compact JSON capped at `BANNER_MAX_RESPONSE_CHARS` (default 60 000). A page
that would exceed the cap is trimmed to whole records and carries a `truncation` object
telling the model how many records were omitted, the `nextOffset` to continue from, and to
narrow the query or pass `fields`. Other oversized results are cut and followed by a
`[TRUNCATED]` notice.

## Configuration

All configuration is environment variables (see [`.env.example`](.env.example)). Invalid values
stop the server with a message naming the variable (never its value).

| Variable | Default | Notes |
| --- | --- | --- |
| `ETHOS_API_KEY` | (required) | API key of a dedicated Ethos application |
| `ETHOS_BASE_URL` | `https://integrate.elluciancloud.com` | Regional host if needed; https only |
| `BANNER_REQUEST_TIMEOUT_MS` | `30000` | Per-attempt timeout (1000-300000) |
| `BANNER_BASE_URL`, `BANNER_USERNAME`, `BANNER_PASSWORD` | unset | All three enable `banner_api_get` |
| `BANNER_API_PATH_PREFIXES` | `/StudentApi/api/,/BannerAdminBPAPI/api/` | Comma list of path prefixes `banner_api_get` may read; anything else on the host (admin consoles, UI pages) is refused |
| `BANNER_PRELOAD_DOMAINS` | `student` | Comma list of `student,financial_aid,finance,hr,ethos`, or `all`, or `none` |
| `BANNER_ALLOW_WRITES` | `false` | Registers create/update/delete and notification consume |
| `BANNER_MAX_RESPONSE_CHARS` | `60000` | 2000-5000000 |
| `BANNER_AUDIT_LOG` | `true` | One JSON line per tool call on stderr |
| `BANNER_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` (diagnostic messages only) |
| `BANNER_MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `BANNER_MCP_HTTP_HOST` | `127.0.0.1` | Bind address |
| `BANNER_MCP_HTTP_PORT` | `3001` | |
| `BANNER_MCP_HTTP_TOKEN` | unset | **Required for http**, at least 32 characters |
| `BANNER_MCP_ALLOWED_HOSTS` | unset | Optional `Host` header allow-list (comma list, include port if non-default) |
| `BANNER_MCP_MAX_SESSIONS` | `50` | Concurrent HTTP sessions |
| `BANNER_MCP_SESSION_IDLE_MINUTES` | `30` | Idle HTTP sessions are closed |

## Claude Code setup

Build first (`npm run build`), then register the server. Keep secrets out of shell history,
repositories and Claude Code's own config files: export them from your secret manager in the
shell that launches Claude Code.

**Recommended: project `.mcp.json`** (checked in without secrets). `${VAR}` is expanded from
the environment each time Claude Code starts the server, so the key is never written to disk:

```json
{
  "mcpServers": {
    "banner": {
      "command": "node",
      "args": ["/path/to/banner-mcp-server/dist/index.js"],
      "env": {
        "ETHOS_API_KEY": "${ETHOS_API_KEY}",
        "BANNER_PRELOAD_DOMAINS": "student"
      }
    }
  }
}
```

**`claude mcp add`** works too, but `-e NAME=value` stores the **literal value** in
`~/.claude.json` (user scope) or the project config (other scopes). The shell expands the
variable before Claude Code sees it, so the API key ends up in that file in plaintext. Prefer
the `.mcp.json` form above; if you use `claude mcp add`, protect that file and rotate the
key when a workstation changes hands.

PowerShell (ChSCC admin workstations). Environment variables are `$env:NAME`, not `$NAME`:

```powershell
claude mcp add banner --scope user `
  -e "ETHOS_API_KEY=$env:ETHOS_API_KEY" `
  -e BANNER_PRELOAD_DOMAINS=student `
  -- node C:\path\to\banner-mcp-server\dist\index.js
```

bash:

```bash
claude mcp add banner --scope user \
  -e ETHOS_API_KEY="$ETHOS_API_KEY" \
  -e BANNER_PRELOAD_DOMAINS=student \
  -- node /path/to/banner-mcp-server/dist/index.js
```

If the variable is unset in the launching shell (for example `$ETHOS_API_KEY` typed in
PowerShell, where it is an empty PowerShell variable), the key is registered as empty and the
server exits with `ETHOS_API_KEY environment variable is required` on first use.

**Remote HTTP server:**

```bash
claude mcp add --transport http banner https://banner-mcp.example.edu/mcp \
  --header "Authorization: Bearer $BANNER_MCP_HTTP_TOKEN"
```

Try: "Use banner_person_lookup to find A00123456, then show their student context for 202680."

## HTTP deployment

```bash
export BANNER_MCP_TRANSPORT=http
export BANNER_MCP_HTTP_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
export ETHOS_API_KEY=...            # from your secret store
node dist/index.js                  # listens on 127.0.0.1:3001
```

- `POST/GET/DELETE /mcp`: MCP Streamable HTTP. Every request needs
  `Authorization: Bearer <BANNER_MCP_HTTP_TOKEN>` (compared in constant time). Missing or wrong
  tokens get `401` and an audit line.
- `GET /healthz`: `{"status":"ok"}`, no auth, no data. Use it for load balancer checks.
- Each client session gets its own MCP server instance, keyed by the `mcp-session-id` header
  (stateful pattern from the MCP TypeScript SDK). Sessions end on `DELETE /mcp`, transport close,
  or after `BANNER_MCP_SESSION_IDLE_MINUTES` idle. Request bodies are limited to 1 MB; a larger
  body gets HTTP `413` with `Connection: close` (bodies over 16 MB, or announced as such by
  `Content-Length`, are refused without being read).
- The server speaks plain HTTP. Put it behind a TLS-terminating reverse proxy (IIS ARR, nginx,
  Azure App Gateway) restricted to campus/VPN networks, and set `BANNER_MCP_ALLOWED_HOSTS` to
  the public host name.

### Docker

The image runs the HTTP transport as the non-root `node` user. Because the SDK is a sibling
checkout, build from the directory that contains both repositories:

```bash
docker build -f banner-mcp-server/Dockerfile -t banner-mcp-server:0.2.0 .
docker run -d --name banner-mcp -p 127.0.0.1:3001:3001 \
  --env-file /secure/banner-mcp.env banner-mcp-server:0.2.0
```

Inside the container the server binds `0.0.0.0` (required for port publishing); publish the
port on loopback or an internal interface only and front it with TLS. The image has a
`HEALTHCHECK` on `/healthz`. Secrets are passed at run time and never baked into the image.

## Security and FERPA model

- **Read-only by default.** Write tools and notification consumption are not registered at all
  unless `BANNER_ALLOW_WRITES=true`; a model cannot call a tool that does not exist.
  `banner_status` reports `writesEnabled`. GraphQL documents are parsed with the reference `graphql` parser
  and rejected unless every operation is a query. `banner_api_get` only issues `GET`, only
  to paths under `BANNER_API_PATH_PREFIXES` on the configured host (no scheme/host, dot
  segments or encoded separators), so the service account's credentials never reach other
  Banner web applications.
- **Least data.** `banner_person_lookup` and `banner_student_context` return summaries without
  date of birth, SSN-type credentials, addresses or phones. A `privacy` value of `restricted`
  (Banner confidentiality flag) is surfaced and the model is told not to disclose the record.
  Use `fields` to limit full records.
- **Audit log.** Each tool call writes one JSON line to stderr:
  `{"ts","type":"tool_call","tool","args","durationMs","resultCount","truncated","error","sessionId"}`.
  Values of identifying fields (Banner ID, email, names, SSN, DOB, identity documents,
  credentials, phone, address, passwords/tokens) are replaced with `[redacted]`, and so is any
  string that looks like an email or a Banner ID, wherever it appears (including arrays).
  Free-form `criteria` (generic Ethos tools) and object payloads (`data`, `variables`,
  REST `query`) are logged as key structure only, with every value except GUIDs redacted.
  GraphQL documents are logged as an HMAC fingerprint keyed with a random per-process secret,
  so they cannot be reversed by hashing candidate IDs. REST paths keep only the API base
  (`/StudentApi/api`); later segments are masked and query strings dropped. Response bodies are never logged. HTTP auth failures and session
  open/close/expiry are logged too. Ship stderr to your SIEM and retain it per your records
  policy.
- **No secrets in output.** Errors come from the SDK, whose messages contain only the HTTP
  status line and Ethos error codes, never response bodies or credentials.
- **HTTP hardening.** Mandatory bearer token (32+ chars), loopback bind by default, per-session
  isolation, session cap and idle expiry, 1 MB body limit, optional Host allow-list.
- **Who can use it.** Anyone who can reach the server with the token, or run it with the API
  key, sees what the Ethos application can see. Issue tokens only to staff whose role
  justifies that access, rotate the token and API key on staff changes, and prefer separate
  deployments (and Ethos applications) for different audiences, for example a registrar
  deployment with student resources only and an HR deployment with employee resources only.

## Ethos API key setup

Ask your Ethos Integration administrator to create a **dedicated application** for this server
(do not reuse another integration's key: consuming change notifications would steal its
messages, and audit trails get mixed).

1. In **Ethos Integration > Applications**, create an application (e.g. "Banner MCP - Registrar")
   and generate its API key. Store the key in your secret manager.
2. On the application's **API Access** (accessible resources), grant access to the resources
   provided by your Banner authoritative source, at the versions this server requests:

   | Domain | Resource | Version |
   | --- | --- | --- |
   | student | `persons` | v12 |
   | student | `students` | v16 |
   | student | `courses` | v6 |
   | student | `sections` | v16 |
   | student | `section-registrations` | v16 |
   | student | `academic-periods` | v16 |
   | financial_aid | `financial-aid-applications` | v9 |
   | financial_aid | `student-financial-aid-awards` | v11 |
   | finance | `accounting-strings` | v7 |
   | finance | `ledger-activities` | latest |
   | hr | `employees` | v12 |
   | hr | `institution-positions` | v12 |
   | hr | `institution-jobs` | v12 |

   Grant only the domains a deployment needs (a registrar deployment needs only the student
   rows). For the `ethos` domain, grant whichever extra resources you want generic access to
   (for example `academic-levels`, `student-types`, `sites` to resolve GUID references), and
   enable QAPI or GraphQL (Ethos Data Access) for them only if you use those tools.
3. If your tenant lets you restrict methods per resource, allow **GET** only (plus `POST` on
   `/qapi` for QAPI search). Grant `POST`/`PUT`/`DELETE` and a **change-notification
   subscription** only for a deployment that runs with `BANNER_ALLOW_WRITES=true`.
4. Make sure the Banner Ethos API (Banner Integration API) for each resource is deployed and
   mapped in Ethos for your Banner environment; a resource missing on the Banner side returns
   404/`Global.NotFound` even when the application has access.

A `403` from a tool means the application lacks access to that resource or version; the error
message says to ask the Ethos administrator. Requests for a version that is not granted can
also fail with `406`.

For **Banner REST** (`banner_api_get`), use a dedicated Banner account with read-only access to
only the API pages you need.

## Development

```bash
npm ci
npm run lint        # eslint + prettier --check
npm run typecheck   # src and tests
npm run build
npm test            # vitest; Ethos/Banner HTTP is mocked, no credentials needed
```

Layout: `src/server.ts` (server factory and core tools), `src/domains/*` (tool sets),
`src/tools/define.ts` (tool wrapper: audit, errors, output cap), `src/output.ts` (projection
and truncation), `src/audit.ts`, `src/transport/{stdio,http}.ts`, `src/config.ts`.

## License

MIT
