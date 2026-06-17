import "../benchmark/loadEnv";

import { main } from "../../packages/walkthrough-review-cli/src/cli.js";

await main(process.argv.slice(2));
