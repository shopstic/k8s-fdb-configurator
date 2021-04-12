import configure from "./actions/configure.ts";
import createConnectionString from "./actions/create-connection-string.ts";
import syncConnectionString from "./actions/sync-connection-string.ts";
import prepareLocalPv from "./actions/prepare-local-pv.ts";
import { CliProgram } from "./deps/cli-utils.ts";

await new CliProgram()
  .addAction("prepare-local-pv", prepareLocalPv)
  .addAction("configure", configure)
  .addAction("create-connection-string", createConnectionString)
  .addAction("sync-connection-string", syncConnectionString)
  .run(Deno.args);
