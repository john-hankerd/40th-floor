// Collects "notify me" signups for apps that aren't live yet.
// Sends a notification to John and a confirmation to the signer via Resend.
// Set RESEND_API_KEY in Netlify env vars. No RESEND_API_KEY = signups are
// still accepted, just not emailed anywhere (check function logs instead).

const https = require("https");

const NOTIFY_EMAIL = process.env.WAITLIST_NOTIFY_EMAIL || "40thFloorinfo@gmail.com";
const FROM_EMAIL = process.env.WAITLIST_FROM_EMAIL || "40th Floor <onboarding@resend.dev>";

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function sendEmail(resendKey, { to, subject, html }) {
  const body = JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html });
  const options = {
    hostname: "api.resend.com",
    path: "/emails",
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
  };
  return httpsRequest(options, body);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { app, email } = payload;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!app || !email || !emailPattern.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing or invalid app/email" }) };
  }

  console.log(`Waitlist signup: ${email} -> ${app}`);

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      await sendEmail(resendKey, {
        to: NOTIFY_EMAIL,
        subject: `New waitlist signup — ${app}`,
        html: `<p><strong>${email}</strong> asked to be notified when <strong>${app}</strong> launches.</p>`,
      });

      await sendEmail(resendKey, {
        to: email,
        subject: `You're on the list for ${app}`,
        html: `<p>Thanks for your interest in <strong>${app}</strong>, part of the 40th Floor suite.</p><p>We'll email this address the moment it's ready to try, free.</p>`,
      });
    } catch (err) {
      console.warn("Waitlist email failed:", err.message);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
};
