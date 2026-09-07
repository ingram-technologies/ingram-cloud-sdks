#!/usr/bin/env node
import { run } from "@stricli/core";

import { buildIc } from "./app";

await run(buildIc(), process.argv.slice(2), { process });
