// Sends via Cloudflare Email Routing's Worker binding (wrangler.jsonc's
// send_email, bound as env.CONTACT_EMAIL) - no third-party service, no
// account to sign up for, just a Cloudflare feature on a domain already
// managed there. The "from" address must be on this same zone
// (goldenvalleygunsllc.com); it doesn't need its own mailbox/routing rule
// to send FROM.
//
// 2026-07-20: `to` and `replyTo` became parameters (previously hardcoded to
// Shawn's inbox only) so this same helper can send order confirmations and
// build-status updates straight to customers, and so Shawn can hit "Reply"
// on a contact-form notification and land in the customer's inbox instead
// of noreply@. Sending to anything other than a verified account address
// (i.e. any real customer) requires the domain to be onboarded for sending
// in the Cloudflare dashboard - see wrangler.jsonc's comment on
// send_email - otherwise this throws.
import { EmailMessage } from 'cloudflare:email';
import { createMimeMessage } from 'mimetext';

const SEND_FROM = 'noreply@goldenvalleygunsllc.com';

export async function sendEmail(env, { to = 'goldenvalleyguns@gmail.com', subject, text, replyTo }) {
  const msg = createMimeMessage();
  msg.setSender({ name: 'Golden Valley Guns', addr: SEND_FROM });
  msg.setRecipient(to);
  msg.setSubject(subject);
  if (replyTo) msg.setHeader('Reply-To', replyTo);
  msg.addMessage({ contentType: 'text/plain', data: text });

  const message = new EmailMessage(SEND_FROM, to, msg.asRaw());
  await env.CONTACT_EMAIL.send(message);
}
