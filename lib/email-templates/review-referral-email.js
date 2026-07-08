// Baked-in "review + referral" post-install email.
//
// No environment variables are required to send this — edit the constants
// below directly (and redeploy) whenever the real Google review link or
// referral offer changes. AQUOZ_REVIEW_URL / AQUOZ_REFERRAL_AMOUNT env vars,
// if set, still override these without a code change.

const REVIEW_URL = 'https://g.page/r/REPLACE-WITH-GOOGLE-REVIEW-LINK/review';
const REFERRAL_AMOUNT = '$200';
const SENDER_NAME = 'Anna';
const SENDER_ROLE = 'Customer Care, Aquoz Water Filtration';
const LOGO_URL = 'https://waterfilter.aquoz.com.au/assets/aquoz-logo.png';

function htmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstNameOf(opportunity) {
  const name = String(opportunity.contactName || opportunity.name || '').trim();
  return name.split(/\s+/)[0] || 'there';
}

function buildReviewReferralEmail(opportunity, note = '', overrides = {}) {
  const firstName = firstNameOf(opportunity);
  const safeFirstName = htmlEscape(firstName);
  const safeNote = htmlEscape(String(note || '').trim());
  const reviewUrl = overrides.reviewUrl || REVIEW_URL;
  const referralAmount = overrides.referralAmount || REFERRAL_AMOUNT;
  const subject = `A quick favour, ${firstName}? \u{1F4A7}`;

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#eef7fa;font-family:'Plus Jakarta Sans',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef7fa;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(10,35,52,.12);">
        <tr>
          <td style="background:#ffffff;padding:26px 32px;text-align:left;border-bottom:3px solid #46c2d6;">
            <img src="${LOGO_URL}" alt="Aquoz Water Filtration" height="32" style="display:block;border:0;">
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 6px;">
            <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#102433;">Hi ${safeFirstName},</p>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#3c4a53;">
              Thank you again for choosing Aquoz Water Filtration &mdash; we hope your new system is already making
              every glass taste better.
            </p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#3c4a53;">
              Two quick things while we have you:
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:0 32px 8px;">
            <table role="presentation" width="100%" style="background:#f8fbfd;border:1px solid #e3edf2;border-radius:12px;">
              <tr>
                <td style="padding:18px 20px;">
                  <p style="margin:0 0 10px;font-size:13px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#1880bd;">1 &middot; Leave us a review</p>
                  <p style="margin:0 0 14px;font-size:14.5px;line-height:1.6;color:#3c4a53;">
                    If you have a minute, a quick Google review helps other local families find us &mdash; it means a lot to our team.
                  </p>
                  <a href="${htmlEscape(reviewUrl)}" style="display:inline-block;background:#1880bd;color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 22px;border-radius:999px;">Leave a Google review &rarr;</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:14px 32px 8px;">
            <table role="presentation" width="100%" style="background:#fdf3dc;border:1px solid #f3ce7d;border-radius:12px;">
              <tr>
                <td style="padding:18px 20px;">
                  <p style="margin:0 0 10px;font-size:13px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#c98a12;">2 &middot; Refer a friend, get ${htmlEscape(referralAmount)}</p>
                  <p style="margin:0;font-size:14.5px;line-height:1.6;color:#5a4009;">
                    Know someone who'd love better water at home? For every friend you refer who goes ahead with
                    Aquoz, we'll send you a <strong>${htmlEscape(referralAmount)} gift card</strong> as a thank-you &mdash;
                    no limit on how many.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${safeNote ? `<tr>
          <td style="padding:14px 32px 0;">
            <p style="margin:0;font-size:14.5px;line-height:1.6;color:#3c4a53;font-style:italic;">${safeNote}</p>
          </td>
        </tr>` : ''}

        <tr>
          <td style="padding:22px 32px 32px;">
            <p style="margin:0;font-size:14.5px;line-height:1.7;color:#3c4a53;">
              Just reply to this email any time &mdash; happy to help.
            </p>
            <p style="margin:18px 0 0;font-size:14.5px;line-height:1.5;color:#102433;">
              Warm regards,<br>
              <strong>${htmlEscape(SENDER_NAME)}</strong><br>
              <span style="color:#5b6f7d;font-size:13px;">${htmlEscape(SENDER_ROLE)}</span>
            </p>
          </td>
        </tr>
      </table>
      <p style="max-width:560px;margin:18px auto 0;font-size:11.5px;color:#8ba2b1;">Aquoz Water Filtration &middot; waterfilter.aquoz.com.au</p>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${firstName},`,
    '',
    "Thank you again for choosing Aquoz Water Filtration — we hope your new system is already making every glass taste better.",
    '',
    '1) Leave us a review — it helps other local families find us:',
    reviewUrl,
    '',
    `2) Refer a friend, get ${referralAmount} — for every friend who goes ahead with Aquoz, we'll send you a ${referralAmount} gift card. No limit on how many.`,
    note && String(note).trim() ? `\n${String(note).trim()}` : '',
    '',
    'Just reply to this email any time — happy to help.',
    '',
    'Warm regards,',
    SENDER_NAME,
    SENDER_ROLE,
  ].filter(Boolean).join('\n');

  return { subject, html, text, reviewUrl, referralAmount };
}

module.exports = {
  buildReviewReferralEmail,
  REVIEW_URL,
  REFERRAL_AMOUNT,
  SENDER_NAME,
  SENDER_ROLE,
};
