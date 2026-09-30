/**
 * Stands in for `nodemailer` under the demo harness (../fle-hooks.mjs): the
 * SMTP boundary, faked because no mailbox is connected in any workspace we may
 * use and no email may reach a prospect. `sendMail` records the message in
 * `globalThis.__FLE_MAIL__`. An address containing "bounce" is refused the way
 * a real server refuses an unknown user at RCPT TO (550 5.1.1), so the
 * product's bounce path runs for real.
 */
function outbox() {
  const g = globalThis;
  if (!g.__FLE_MAIL__) g.__FLE_MAIL__ = [];
  return g.__FLE_MAIL__;
}

function createTransport(options) {
  return {
    options,
    async sendMail(message) {
      const to = String(message.to ?? "");
      if (/bounce/i.test(to)) {
        const error = new Error(`Can't send mail - all recipients were rejected: 550 5.1.1 <${to}>: Recipient address rejected: User unknown`);
        Object.assign(error, { code: "EENVELOPE", responseCode: 550, command: "RCPT TO", rejected: [to], response: "550 5.1.1 User unknown" });
        throw error;
      }
      const record = {
        host: options?.host ?? null,
        from: message.from,
        to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers ?? {},
        messageId: message.messageId,
        at: new Date().toISOString(),
      };
      outbox().push(record);
      return { messageId: message.messageId ?? `<fle-${outbox().length}@fake.invalid>`, accepted: [to], rejected: [] };
    },
    async verify() {
      return true;
    },
    close() {},
  };
}

const nodemailer = { createTransport };
export default nodemailer;
export { createTransport };
