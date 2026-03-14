# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project scaffolding
- MCP server with dual transport (stdio + HTTP)
- Domain registry with lazy-loading architecture
- Config module with environment variable support
- Error handler middleware for Banner SDK errors
- Student domain: persons search/get, students search/get
- Navigator tools: banner_navigate, banner_status
- Ethos domain: GraphQL query tool (banner_ethos_graphql)
- Ethos domain: QAPI search tool (banner_ethos_qapi_search)
- Ethos domain: criteria filter tool (banner_ethos_filter)
- Ethos domain: change notifications tool (banner_ethos_consume_notifications)
- Financial Aid domain: applications search/get, awards search/get
- Finance domain: accounting strings search/get, ledger activities search/get
- HR domain: employees search/get, positions search/get, jobs search/get

### Changed

- Student handlers now use typed SDK resource accessors (e.g., `client.persons.get(id)`) instead of generic `client.get("persons", id, version)`
