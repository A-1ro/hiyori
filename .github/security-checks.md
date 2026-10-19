# Security checks

The `Security` workflow runs on pull requests, pushes to `main`, manual dispatch,
and Sundays at 14:17 UTC (23:17 Asia/Tokyo). Scheduled runs use the default
branch and start only after the workflow is merged. GitHub may delay or drop
scheduled runs under load, and disables schedules in public repositories after
60 days without repository activity. Completion before Monday 08:00 JST is not
guaranteed. Check Actions for the latest completed run rather than assuming it ran.

## Dependency audit

The committed pnpm workspace lockfile is checked against the public npm registry,
including development and optional dependencies. No project dependencies are
installed and no project lifecycle scripts run in this job. Package names and
versions are sent to the registry's advisory API; source code is not sent.
The package manager is pnpm 10.33.2.

Any low, moderate, high, or critical finding fails the job. The log includes
advisory details and the job summary includes severity counts. The error title
`Dependency vulnerabilities detected` means a completed scan found issues;
`Dependency audit could not complete` means a registry, command, or report error.
Setup failures/timeouts also mean incomplete coverage. A failed scan is never a
clean security result. No automatic fixes, suppressions, or ignored registry
errors are configured. Findings require separate review and remediation.
Only dependencies represented in the committed lockfile are covered; generated
projects, unlocked fixtures, system packages, and vulnerabilities without a
published advisory are outside this check.

## Code scanning

CodeQL scans actions, javascript-typescript with the
`security-extended` query suite and `build-mode: none`. No application build or
deployment is invoked. Results are uploaded to GitHub code scanning; database
upload is disabled. A successful analysis/upload is not proof of zero alerts:
review the repository Security tab and the CodeQL pull request check separately.
Generated code that is absent from the checkout and unsupported languages are
outside this scan. This is static analysis, not a production penetration test.

The workflow uses SHA-pinned upstream Actions, GitHub-hosted runners, read-only
checkout with no persisted credentials, and no deployment/release secrets.
Only the CodeQL job gets `security-events: write`, for result upload. Dependabot
keeps Action pins and package dependencies under review through update PRs.

Repository Security settings (Dependabot alerts/security updates, secret scanning,
push protection, and CodeQL default setup) are managed separately. This workflow
does not change those settings or grant new account/app access. Before enabling
CodeQL default setup later, reconcile it with this advanced workflow to avoid
overlapping configurations. Secret scanning is outside this workflow's scope.

## References

- [CodeQL workflow options](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options)
- [CodeQL Action permissions and supported versions](https://github.com/github/codeql-action)
- [npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit/)
- [pnpm audit](https://pnpm.io/10.x/cli/audit)
- [GitHub scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
