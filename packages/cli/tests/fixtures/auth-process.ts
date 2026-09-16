import { CliAuth } from "../../src/auth";
process.send?.("ready");
process.once(
  "message",
  async (message: {
    origin: string;
    directory: string;
    action: "token" | "logout";
  }) => {
    try {
      const auth = new CliAuth(message.origin, message.directory);
      const result =
        message.action === "logout" ? await auth.logout() : await auth.token();
      process.send?.({ result }, () => process.disconnect());
    } catch (error) {
      process.send?.(
        { error: error instanceof Error ? error.message : "Failed" },
        () => process.disconnect(),
      );
    }
  },
);
