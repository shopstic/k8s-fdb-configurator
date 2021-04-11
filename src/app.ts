import configure from "./actions/configure.ts";
import createConnectionString from "./actions/create-connection-string.ts";
import syncConnectionString from "./actions/sync-connection-string.ts";
import { CliProgram } from "./deps/cli-utils.ts";

await new CliProgram()
  .addAction("configure", configure)
  .addAction("create-connection-string", createConnectionString)
  .addAction("sync-connection-string", syncConnectionString)
  .run(Deno.args);
