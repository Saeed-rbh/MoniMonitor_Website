# Temporary dependency audit exception

GHSA-vfj7-8cjw-p6xm affects braces through 3.0.3 with no published patched
version as of October 3, 2026. Tailwind 3 brings this package through its file
watcher and glob dependencies. The app's Tailwind content configuration scans
only repository source and index.html; transaction data and email bodies are
not supplied as glob patterns. These dependencies are build tools and are not
included as executing code in the browser bundle or backend.

Until November 3, 2026, verification accepts this exact advisory only when every
affected lockfile path is marked dev-only. Dependent-package findings qualify
only if all their advisory chains lead to this exception. Other advisories,
runtime paths, malformed reports, audit failures, and an available braces patch
still fail verification. Every accepted finding is printed in the check logs.
The expiration requires a fresh review rather than permanent suppression.
Some npm versions report migration to Tailwind 4 as an available major fix.
That specific migration recommendation is accepted during the exception period;
an actual braces patch or a compatible upgrade remains blocking.

Follow up by upgrading once a patch is published, or migrating the Tailwind
build pipeline to a dependency tree without braces. Do not remove or weaken
the checks to accommodate other findings.

Source: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
