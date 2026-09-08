import { GenericContainer, Wait } from "testcontainers";
import { z } from "zod";

/** Real SMTP delivery; Mailpit is an isolated local capture sink, never external email. */
export async function startMailpit() {
  const container = await new GenericContainer("axllent/mailpit:v1.30.4")
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp("/livez", 8025))
    .start();
  const url = `http://${container.getHost()}:${String(container.getMappedPort(8025))}`;
  return {
    smtpUrl: `smtp://${container.getHost()}:${String(container.getMappedPort(1025))}`,
    url,
    async messages(email: string) {
      const page = z
        .object({
          messages: z.array(
            z.object({
              ID: z.string(),
              To: z.array(z.object({ Address: z.string() })),
              Subject: z.string(),
            }),
          ),
        })
        .parse(await (await fetch(`${url}/api/v1/messages`)).json());
      return Promise.all(
        page.messages
          .filter((message) =>
            message.To.some((recipient) => recipient.Address === email),
          )
          .map(async (message) =>
            z
              .object({ ID: z.string(), Subject: z.string(), Text: z.string() })
              .parse(
                await (
                  await fetch(`${url}/api/v1/message/${message.ID}`)
                ).json(),
              ),
          ),
      );
    },
    async close() {
      await container.stop();
    },
  };
}
