import { createCliAction, ExitCode } from "../deps/cli-utils.ts";
import { joinPath } from "../deps/std-path.ts";
import { Type } from "../deps/typebox.ts";
import { NonEmptyString } from "../types.ts";
import { captureExec, inheritExec } from "../deps/exec-utils.ts";
import { kubectlGetJson, kubectlInherit } from "../utils.ts";
import { loggerWithContext } from "../logger.ts";

const logger = loggerWithContext("main");

export default createCliAction(
  Type.Object({
    nodeNameEnvVarName: NonEmptyString(),
    pendingDeviceIdsLabelName: NonEmptyString(),
    rootMountPath: NonEmptyString(),
  }),
  async (
    {
      nodeNameEnvVarName,
      pendingDeviceIdsLabelName,
      rootMountPath,
    },
  ) => {
    const nodeName = Deno.env.get(nodeNameEnvVarName);

    if (!nodeName) {
      throw new Error(`${nodeNameEnvVarName} env variable is not set`);
    }

    const nodeLabels = await kubectlGetJson({
      args: [
        `node/${nodeName}`,
        "-o=jsonpath={.metadata.labels}",
      ],
      schema: Type.Dict(Type.String()),
    });

    const deviceIdsString =
      (typeof nodeLabels[pendingDeviceIdsLabelName] === "string")
        ? nodeLabels[pendingDeviceIdsLabelName]
        : "";
    const deviceIds = deviceIdsString.split(",");

    if (deviceIds.length === 0) {
      logger.info(
        `Node label '${pendingDeviceIdsLabelName}' is empty, nothing to do`,
      );
      return ExitCode.Zero;
    }

    logger.info(
      `Going to prepare the following ${deviceIds.length} devices: ${
        deviceIds.join(", ")
      }`,
    );

    for (const deviceId of deviceIds) {
      const devicePath = joinPath(
        "/dev/disk/by-id",
        deviceId,
      );
      const mountPath = joinPath(rootMountPath, deviceId);
      const mountpointCheck = Deno.run({
        cmd: ["mountpoint", mountPath],
        stdout: "null",
        stderr: "null",
      });
      const isMounted = (await mountpointCheck.status()).code === 0;

      if (!isMounted) {
        logger.info(`${mountPath} is not mounted`);
        logger.info(`Checking for existing file system inside ${devicePath}`);

        const wipefsTest = await captureExec({
          run: { cmd: ["wipefs", "-a", "-n", devicePath] },
        });

        if (wipefsTest.trim().length > 0) {
          logger.error(
            `Device possibly contains an existing file system, wipefs test output: ${wipefsTest}`,
          );
          return ExitCode.One;
        }

        logger.info(
          `Making sure /etc/fstab does not already contain a reference to ${devicePath}`,
        );
        const currentFstabContent = await Deno.readTextFile("/etc/fstab");

        if (currentFstabContent.indexOf(devicePath) !== -1) {
          logger.error(
            `Device ${devicePath} found inside /etc/fstab`,
          );
          return ExitCode.One;
        }

        logger.info(`Formatting ${devicePath}`);
        await inheritExec({ run: { cmd: ["mkfs.ext4", devicePath] } });

        logger.info(`Writing ${devicePath} to /etc/fstab`);
        await Deno.writeTextFile(
          "/etc/fstab",
          currentFstabContent + "\n" +
            `${devicePath}  ${mountPath}  ext4  defaults,noatime,discard,nofail  0 0`,
        );

        await Deno.mkdir(mountPath, { recursive: true });
        await inheritExec({
          run: { cmd: ["chattr", "+i", mountPath] },
        });

        logger.info(`Going to mount ${mountPath}`);
        await inheritExec(
          {
            run: {
              cmd: [
                "nsenter",
                "-t",
                "1",
                "-m",
                "-u",
                "-n",
                "-i",
                "mount",
                `--source=${devicePath}`,
              ],
            },
          },
        );
      } else {
        logger.info(`${mountPath} is already a mountpoint, nothing to do`);
      }
    }

    logger.info(
      `Removing '${pendingDeviceIdsLabelName}' label from node ${nodeName}`,
    );

    await kubectlInherit({
      args: [
        "label",
        `node/${nodeName}`,
        `${pendingDeviceIdsLabelName}-`,
      ],
    });

    return ExitCode.Zero;
  },
);
