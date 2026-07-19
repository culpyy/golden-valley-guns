// Sends via Cloudflare Email Routing's Worker binding (wrangler.jsonc's
// send_email, bound as env.CONTACT_EMAIL) - no third-party service, no
// account to sign up for, just a Cloudflare feature on a domain already
// managed there. The "from" address must be on this same zone
// (goldenvalleygunsllc.com); it doesn't need its own mailbox/routing rule
// to send FROM, only the destination needs to be a verified address
// (already done - see wrangler.jsonc's comment on the send_email binding).
import { EmailMessage } from 'cloudflare:email';
import { createMimeMessage } from 'mimetext';

export async function sendEmail(env, { subject, text }) {
  const msg = createMimeMessage();
  msg.setSender({ name: 'Golden Valley Guns Website', addr: 'noreply@goldenvalleygunsllc.com' });
  msg.setRecipient('goldenvalleyguns@gmail.com');
  msg.setSubject(subject);
  msg.addMessage({ contentType: 'text/plain', data: text });

  const message = new EmailMessage('noreply@goldenvalleygunsllc.com', 'goldenvalleyguns@gmail.com', msg.asRaw());
  await env.CONTACT_EMAIL.send(message);
}
