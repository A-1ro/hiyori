# OAuth provider 1.x migration

## Resource identity and existing grants

Hiyori exposes one protected OAuth resource, `/mcp`. The provider must use the
request origin plus that exact path, not the bare origin or the current request
path. This preserves the audience advertised by 0.8.3 and rejects a bound token
presented on a different production, preview, or loopback development origin. Unrelated Web/API/Webcal requests
continue directly through their existing Hono handlers, so an HTTP feed request
does not construct an invalid HTTP OAuth resource. A bounded last-origin cache prevents
one hostname's provider being reused for a different hostname.

A read-only check on 2026-10-19 confirmed that production `/mcp` challenges point
to `https://hiyori-schedule.com/.well-known/oauth-protected-resource/mcp`, whose
`resource` is exactly `https://hiyori-schedule.com/mcp`.

No KV rewrite, new credentials, bindings, or storage migration is needed. The
regression test creates actual encrypted grants with the pinned **test-only**
0.8.3 package, then verifies access and refresh with 1.2.3 for both `/mcp`-bound
and older unbound grants. The same user's read-only permission remains read-only
after refresh. The legacy package is not imported by application code.

Before production rollout, review whether any clients used another resource
(e.g. the root metadata URL or `/mcp/` with a trailing slash). Those grants are
not equivalent to `/mcp` and may require renewed authorization. Public discovery
and synthetic migration tests do not prove the audience of every production
grant; production KV and real user tokens were not accessed for this change.

Legacy audience-less tokens are an explicit compatibility exception: upstream
1.x treats them as bound to the current provider's sole resource until refresh
creates a bound token. They do not gain cross-origin isolation before refresh
when hosts share KV (as production and e2e currently do). This retains the 0.x
compatibility behavior; this upgrade does not change KV sharing or choose a
single production-only migration resource.

## Scope and client compatibility

`scopesSupported` remains the authorization server's catalogue (`hiyori:read`,
`hiyori:write`). Do not copy it into `requiredScopes`: upstream uses that field
for the baseline scope challenge. Hiyori does not require both permissions for
every MCP request, and tools enforce their individual permissions.

A narrow response adapter publishes these optional capabilities as
`scopes_supported` in the successful canonical GET protected-resource metadata
response. It preserves the resource and authorization-server identities and
other fields. The provider's internal `requiredScopes` stays unset, and the
unauthenticated challenge has no `scope` parameter. A client can discover and
request both capabilities, but users still choose their consent; omitted scope
still defaults to read-only and a rejected write scope cannot return on refresh.
Actual ChatGPT/Claude connector interoperability has not been verified by these
synthetic tests.

Authorization errors use the provider's helper with the freshly validated
request, so denial and invalid-scope redirects include the canonical `iss`
advertised by authorization-server metadata, alongside the original state.
Client-supplied issuer values are ignored.

The API handler now intersects the original consent scopes with the verified
access-token scopes (`ctx.auth.scope`). This also fixes a pre-existing bug:
a read+write grant refreshed with `scope=hiyori:read` used to retain write access
through its encrypted consent props. Such narrowed tokens now correctly lose
write access; full-scope tokens and the existing session-Bearer path retain their
previous permissions. No stored grant is edited.

MCP tools read identity and scopes from request-local `AsyncLocalStorage`, not
the Durable Object's initial persisted session props. Both OAuth and legacy
Bearer routes overwrite an internal Worker-to-DO auth-context header, and the
agent initializes that context for each Streamable HTTP request. Missing context
fails closed. This prevents session reuse or concurrent requests from recovering
another token's scopes or another user's identity; public callers cannot supply
the internal context themselves.

Upstream 1.2.3 enforces authorization-code + S256 PKCE, HTTPS or loopback HTTP
redirect URIs, and registered grant types. Private-use native redirect schemes
are not enabled. Registered clients relying on remote HTTP/custom-scheme
callbacks or implicit/plain-PKCE flows must be reviewed before rollout, rather
than weakening these checks. Discord IDs remain unchanged, and the web/CLI
session Bearer route, consent controls, and rate limits remain in place.

Upstream reference: https://github.com/cloudflare/workers-oauth-provider/blob/v1.2.3/docs/migration-1.x.md
