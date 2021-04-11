import { createCliAction, ExitCode, Type } from "../deps.ts";
import {
  fdbcliInheritExec,
  fetchCoordinatorEndpointsFromServiceNames,
  fetchStatus,
  readClusterConfig,
} from "../utils.ts";

export default createCliAction(
  Type.Object({
    configFile: Type.String({ minLength: 1 }),
  }),
  async (
    {
      configFile,
    },
  ) => {
    const config = await readClusterConfig(configFile);
    const status = await fetchStatus();

    const currentClusterConfig = status.cluster.configuration;

    const {
      logCount,
      proxyCount,
      resolverCount,
      redundancyMode,
      storageEngine,
      coordinatorServiceNames,
    } = config;

    const currentCoordinators = status.client.coordinators.coordinators
      .map(({ address }) => address)
      .sort()
      .join(" ");

    const coordinators =
      (await fetchCoordinatorEndpointsFromServiceNames(coordinatorServiceNames))
        .sort()
        .join(" ");

    if (currentCoordinators !== coordinators) {
      console.log(
        `Coordinators changed from "${currentCoordinators}" to "${coordinators}", going to configure...`,
      );
      await fdbcliInheritExec(`coordinators ${coordinators}`);
    }

    if (
      !currentClusterConfig ||
      currentClusterConfig.logs !== logCount ||
      currentClusterConfig.proxies !== proxyCount ||
      currentClusterConfig.resolvers !== resolverCount ||
      currentClusterConfig.redundancy_mode !== redundancyMode ||
      currentClusterConfig.storage_engine !== storageEngine
    ) {
      const recoveryState = status.cluster.recovery_state?.name || "unknown";
      const createNew = recoveryState === "configuration_never_created";

      if (status.client.database_status.available || createNew) {
        const cmd = `configure${
          createNew ? " new" : ""
        } ${redundancyMode} ${storageEngine} resolvers=${resolverCount} proxies=${proxyCount} logs=${logCount}`;

        console.log(
          `Configuration changed, going to execute: ${cmd}`,
        );

        await fdbcliInheritExec(cmd);
      } else {
        const recoveryStateDescription =
          status.cluster.recovery_state?.description || "Unknown";

        console.log("Failed configuring database!");
        console.log(`Recovery state name: ${recoveryState}`);
        console.log(`Recovery state description: ${recoveryStateDescription}`);
        console.log(`Attempting to fetch status details...`);

        await fdbcliInheritExec("status details");

        return ExitCode.One;
      }
    } else {
      console.log("No configuration change, nothing to do");
    }

    return ExitCode.Zero;
  },
);
