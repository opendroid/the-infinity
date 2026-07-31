# `/content/schema` — JSON schemas

**Status: empty.** `node.schema.json` is written in Phase 2.

It will be JSON Schema **draft 2020-12**, covering the node shape described in
[`../nodes/README.md`](../nodes/README.md), and enforced on every PR by the `content` job
in CI. A validation script (Node, no dependency beyond `ajv`) will be wired into
`package.json` so the same check runs locally and in CI.

A node that does not validate does not merge. There is no override.
