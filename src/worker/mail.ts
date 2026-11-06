// Sends the login code. No paid service and no own domain: a plain SMTP conversation with Gmail over TLS
// (cloudflare:sockets), authenticated with an app password of the project's Gmail account (SMTP_USER / SMTP_PASS
// secrets). Gmail allows ~500 messages a day, plenty for login codes.
//
// Without those secrets (local development) nothing is sent: the Worker logs the code and, with DEV_LOGIN=1, returns
// it to the login screen.

import { connect } from "cloudflare:sockets";

export interface MailEnv {
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_HOST?: string;
}

export const EMAIL = /^[^\s@<>"',;:\\()[\]]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i;

const enc = new TextEncoder();
const b64 = (s: string) => btoa(String.fromCharCode(...enc.encode(s)));
const header = (s: string) => `=?UTF-8?B?${b64(s)}?=`;

export class MailError extends Error {}

export function mailConfigured(env: MailEnv) {
  return !!(env.SMTP_USER && env.SMTP_PASS);
}

export async function sendMail(env: MailEnv, to: string, subject: string, text: string) {
  if (!EMAIL.test(to)) throw new MailError("bad_address");
  if (!env.SMTP_USER || !env.SMTP_PASS) throw new MailError("not_configured");
  const socket = connect({ hostname: env.SMTP_HOST || "smtp.gmail.com", port: 465 }, { secureTransport: "on", allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const dec = new TextDecoder();
  let buf = "";

  /** Reads one (possibly multi-line) reply and checks its code. */
  async function reply(expect: number) {
    for (;;) {
      const lines = buf.split("\r\n");
      const done = lines.findIndex((l) => /^\d{3} /.test(l));
      if (done >= 0) {
        const code = Number(lines[done].slice(0, 3));
        buf = lines.slice(done + 1).join("\r\n");
        if (code !== expect) throw new MailError(`smtp ${code}: ${lines[done].slice(4, 80)}`);
        return;
      }
      const { value, done: closed } = await reader.read();
      if (closed) throw new MailError("smtp closed");
      buf += dec.decode(value, { stream: true });
    }
  }
  const send = (line: string) => writer.write(enc.encode(`${line}\r\n`));

  try {
    await reply(220);
    await send("EHLO openstudent");
    await reply(250);
    await send(`AUTH PLAIN ${b64(`\0${env.SMTP_USER}\0${env.SMTP_PASS}`)}`);
    await reply(235);
    await send(`MAIL FROM:<${env.SMTP_USER}>`);
    await reply(250);
    await send(`RCPT TO:<${to}>`);
    await reply(250);
    await send("DATA");
    await reply(354);
    const body = b64(text).replace(/.{1,76}/g, "$&\r\n");
    const msg = [
      `From: ${header("OpenŠtudent")} <${env.SMTP_USER}>`,
      `To: <${to}>`,
      `Subject: ${header(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@openstudent>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      body,
      ".",
    ].join("\r\n");
    await send(msg);
    await reply(250);
    await send("QUIT");
  } finally {
    await socket.close().catch(() => {});
  }
}
