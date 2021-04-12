import { createCliAction, ExitCode } from "../deps/cli-utils.ts";
import { Type } from "../deps/typebox.ts";
import { loggerWithContext } from "../logger.ts";

import {
  fdbcliInheritExec,
  fetchCoordinatorEndpointsFromServiceNames,
  fetchStatus,
  readClusterConfig,
} from "../utils.ts";

const logger = loggerWithContext("main");

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
      logger.info(
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

        logger.info(
          `Configuration changed, going to execute: ${cmd}`,
        );

        await fdbcliInheritExec(cmd);
      } else {
        const recoveryStateDescription =
          status.cluster.recovery_state?.description || "Unknown";

        logger.info("Failed configuring database!");
        logger.info(`Recovery state name: ${recoveryState}`);
        logger.info(`Recovery state description: ${recoveryStateDescription}`);
        logger.info(`Attempting to fetch status details...`);

        await fdbcliInheritExec("status details");

        return ExitCode.One;
      }
    } else {
      logger.info("No configuration change, nothing to do");
    }

    return ExitCode.Zero;
  },
);
