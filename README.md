# Ingram Cloud SDKs

The client libraries for [Ingram Cloud](https://cloud.ingram.tech), published
from one workspace. MIT.

| Package                                   | Version | What it is                                                                                            |
| ----------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| [`@ingram-cloud/sdk`](packages/sdk)       | 1.6.0   | The API wire contract: Zod schemas, response and event types, and a typed management client.          |
| [`@ingram-cloud/ai-sdk`](packages/ai-sdk) | 3.0.0   | Run a smith from the Vercel AI SDK: a Responses provider plus identity, memory and approval helpers.  |
| [`@ingram-cloud/eve`](packages/eve)       | 3.0.0   | Run a smith as an [eve](https://vercel.com/eve) agent's model; attach hosted tools over MCP.          |
| [`@ingram-cloud/flue`](packages/flue)     | 2.0.0   | Register a smith as a [Flue](https://flueframework.com) model provider; attach hosted tools over MCP. |
| [`@ingram-cloud/pulumi`](packages/pulumi) | 2.1.1   | Pulumi resources for agents, MCP servers, channels, webhooks and model keys.                          |

Every package rides a standard surface where one exists: the OpenAI-compatible
Responses and Chat Completions APIs for inference, MCP for tools, and the AI
SDK's tool-approval channel for human-in-the-loop. The docs for the API they
wrap are at [cloud.ingram.tech/docs](https://cloud.ingram.tech/docs).

## Working in the repository

```sh
bun install
bun run ci      # lint, format:check, build, typecheck, test
```

Per-package scripts share one set of names; `--filter` selects a package:

```sh
bun run --filter '@ingram-cloud/sdk' test
```

| Script                    | Does                          |
| ------------------------- | ----------------------------- |
| `build`                   | `tsc` to `dist/`              |
| `typecheck`               | `tsc --noEmit`                |
| `lint` / `lint:fix`       | oxlint                        |
| `format` / `format:check` | oxfmt                         |
| `test`                    | The package's test runner     |
| `ci`                      | All of the above, at the root |

Shared configuration lives at the root: `.oxlintrc.json`, `.oxfmtrc.json`, and
the `oxlint`, `oxfmt`, `typescript`, `vitest` and `@types/node`
devDependencies. A package declares only its own runtime and peer
dependencies.

Cross-package dependencies are ordinary semver ranges
(`@ingram-cloud/ai-sdk: ^2.0.0`), not `workspace:*`: the manifest in the tree
is the manifest that is published. Bun resolves a matching range to the
workspace copy, so a change in one package is picked up by its dependants
without a publish, as long as the range is kept current.

## Releasing

Packages are released one at a time, by CI (`.github/workflows/release.yml`,
npm trusted publishing):

1. Bump `version` in the package's `package.json`.
2. Update the version in the table above.
3. Commit, tag the commit `<name>@<version>` (for example `sdk@1.6.0`) and push
   the tag. The workflow builds, tests and publishes that package.

## License

MIT
