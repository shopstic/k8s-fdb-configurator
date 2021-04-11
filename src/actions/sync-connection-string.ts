import { delay } from "../deps/async-utils.ts";
import { createCliAction } from "../deps/cli-utils.ts";
import { Type } from "../deps/typebox.ts";
import {
  fdbcliCaptureExec,
  updateConnectionStringConfigMap,
} from "../utils.ts";

const FDB_CLUSTER_FILE = "FDB_CLUSTER_FILE";
const connectionStringResultRegex =
  /`\\xff\\xff\/connection_string' is `([^']+)'/;

export default createCliAction(
  Type.Object({
    configMapKey: Type.String(),
    configMapName: Type.String(),
    updateIntervalMs: Type.Number(),
  }),
  async (
    {
      configMapKey,
      configMapName,
      updateIntervalMs,
    },
  ) => {
    const clusterFile = Deno.env.get(FDB_CLUSTER_FILE);

    if (!clusterFile) {
      throw new Error(`${FDB_CLUSTER_FILE} env variable is not set`);
    }

    let lastConnectionString = await Deno.readTextFile(clusterFile);

    while (true) {
      try {
        const connectionStringResult = await fdbcliCaptureExec(
          `get \\xFF\\xFF/connection_string`,
        );

        const connectionStringMatch = connectionStringResult.match(
          connectionStringResultRegex,
        );

        if (!connectionStringMatch) {
          throw new Error(
            `Connection string result doesn't match regex: ${connectionStringResult}`,
          );
        }

        const connectionString = connectionStringMatch[1];

        if (connectionString !== lastConnectionString) {
          console.log(
            `Going to update ConfigMap '${configMapName}' with data key '${configMapKey}' and value '${connectionString}'`,
          );

          await updateConnectionStringConfigMap({
            configMapKey,
            configMapName,
            connectionString,
          });

          console.log(`ConfigMap '${configMapName}' updated successfully!`);

          lastConnectionString = connectionString;
        }
      } catch (e) {
        console.error(e.toString());
      }

      await delay(updateIntervalMs);
    }
  },
);
