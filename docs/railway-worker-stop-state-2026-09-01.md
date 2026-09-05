# Railway Worker Stop State

**Observed:** 2026-09-01, live Railway JSON  
**Scope:** `wf-mariadb-shadow` and `wf-mariadb-canonical-normalizer`

## Accurate state

| Service | Git source | Configured replicas | Running | Deployment state |
| --- | --- | ---: | ---: | --- |
| `wf-mariadb-shadow` | disconnected (`source: null`) | 1 | 0 | `CRASHED`, `deploymentStopped: true` |
| `wf-mariadb-canonical-normalizer` | disconnected (`source: null`) | 1 | 0 | exited, `deploymentStopped: true` |

The attempted command `railway scale --service <name> us-west2=0` returned without
an error, but a subsequent `railway service list --json` continued to report
`configured: 1`. Therefore zero configured replicas has **not** been proven and
must not be claimed.

Disconnecting each Git source prevents a new repository commit or merge from
automatically creating a deployment. Combined with `running: 0` and
`deploymentStopped: true`, this is the currently verified stop control. It does
not convert the crashed shadow deployment into a cleanly stopped deployment and
does not change the persisted replica setting to zero.

## Operational boundary

- Do not reconnect either Git source without CTO authorization.
- Do not redeploy, restart, or invoke either worker entry point.
- Read-only `railway run` commands used for bounded audits are not worker
  deployments and must not invoke capture, normalization, publication, or
  materialization code.
- Re-check live JSON immediately before any future authorization decision.

## Read-only launch preflight

The corrected launch preflight passed without starting a worker or writing to a
database. It verified:

- MariaDB TLS certificate pinning and `rejectUnauthorized: true`;
- current source census: `1,508,505` rows;
- immutable checkpoint: `1,487,333` inputs, `8` lossless errors, status `PARTIAL`;
- checkpoint manifest: `fd545df7a5668c28ede4f2c721a9539fcb6f7cf755302a975052b23270b8adb1`;
- `21,172` source rows arrived after the checkpoint boundary;
- all 84 direct private-table privileges remain false;
- the launch gate remains `BLOCKED_PENDING_CTO_AUTHORIZATION`.

Artifact: `audit-output/mariadb-live/launch-preflight/launch-preflight-report.json`  
SHA-256: `a27a9f6b01898d07bb0c8f0ce460c3997243da55c91fde1c2d85bb674de5718c`

## Materialization hardening status

The materializer was changed in source only; it was **not executed**. The design
now builds and validates a separate table, audits attached views and inbound
foreign keys, then refreshes the existing stable table inside one transaction.
Keeping the stable relation OID preserves dependent views and privileges. The
code refuses inbound foreign keys rather than using `CASCADE`.

The repository includes a real PostgreSQL integration test for the stable-table
refresh, attached consumer view, and cross-partition duplicate precedence. It is
guarded by `MATERIALIZATION_TEST_DATABASE_URL`, refuses the production project,
and was skipped locally because no isolated disposable PostgreSQL instance was
configured. Production was not used as a test database.
