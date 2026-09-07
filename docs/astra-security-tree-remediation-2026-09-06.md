# Credential and private-export boundary

The review removes four tracked environment files and the tracked `all_env.txt`
environment dump from the current tree. The dump's embedded Vercel OIDC token
is expired; that finding does not establish a currently active leaked credential.
The local dump is preserved and ignored. Shared history is not rewritten.

`public/index.html` and `public/extract.html` are inert replacements for legacy
tools containing a Moonshot credential. Source removal is complete; revocation
of that previously exposed provider credential has not been verified and remains
an owner/account action. No credential values are reproduced here.

The other tracked-tree scanner hit is the explicit password placeholder in
`HANDOFF_PIPELINE.md`, not a verified live password. New test scanner hits are
synthetic redaction fixtures. Scanner evidence records paths and line numbers,
never matched secret values.

Vite static output uses a reviewed public-asset allowlist. Legacy raw listings,
dealer crawl snapshots and workbooks remain private and are excluded from
deployment. Public dealer APIs use approved database records, never a static
directory fallback or inferred verification from a directory entry.
