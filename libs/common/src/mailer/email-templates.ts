/**
 * HTML email templates.
 *
 * Constraints these templates are written against (do not "modernise" them):
 * - **No JavaScript.** Every mail client strips `<script>`, so a real
 *   copy-to-clipboard button is impossible in an email. The code is rendered
 *   large, monospace and alone on its line so select/long-press grabs exactly
 *   the code and nothing else, and it is repeated in the subject so the user
 *   can read it straight from the notification without opening the mail.
 * - **Tables + inline styles only.** Gmail strips `<style>` blocks in several
 *   clients and supports no flex/grid, so layout is a nested table and every
 *   rule is inline.
 * - **No external assets.** A remote logo would be blocked by image proxying
 *   until "show images" is clicked, so the wordmark is text.
 */

/** A rendered message: subject line plus both MIME alternatives. */
export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const BRAND_AMBER = "#F59E0B";
const TEXT_DARK = "#1A1D21";
const TEXT_MUTED = "#6B7280";
const PAGE_BG = "#F4F5F7";
const CARD_BORDER = "#E6E8EB";
const CODE_BG = "#FFF8EC";

/**
 * Escape the five characters that can break out of HTML text/attribute context.
 * Every interpolation below goes through it: today's callers pass our own
 * strings plus a public id, but a template is exactly the place where a future
 * caller quietly starts passing a product or brand name.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Password-reset verification code.
 *
 * `code` is a server-generated 6-digit string and `ttlMinutes` a number, so
 * neither can inject markup — do not pass user-controlled text here without
 * escaping it first.
 */
export function renderPasswordResetEmail(
  code: string,
  ttlMinutes: number,
): RenderedEmail {
  const subject = `${code} là mã đặt lại mật khẩu TryBuy`;

  const text = [
    `Mã đặt lại mật khẩu TryBuy của bạn là: ${code}`,
    ``,
    `Mã có hiệu lực trong ${ttlMinutes} phút và chỉ dùng được một lần.`,
    `Nhập mã này vào màn hình "Quên mật khẩu" trên TryBuy để đặt lại mật khẩu.`,
    ``,
    `Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này —`,
    `mật khẩu hiện tại của bạn vẫn an toàn. Đừng chia sẻ mã cho bất kỳ ai.`,
  ].join("\n");

  const html = `<!-- preheader: shown as the inbox preview line, hidden in the body -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
Mã ${code} có hiệu lực trong ${ttlMinutes} phút.
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#FFFFFF;border:1px solid ${CARD_BORDER};border-radius:14px;padding:32px 28px;">
        <tr>
          <td style="font-size:20px;font-weight:700;color:${BRAND_AMBER};letter-spacing:-0.3px;padding-bottom:20px;">
            TryBuy
          </td>
        </tr>
        <tr>
          <td style="font-size:19px;font-weight:700;color:${TEXT_DARK};padding-bottom:10px;">
            Đặt lại mật khẩu
          </td>
        </tr>
        <tr>
          <td style="font-size:14px;line-height:22px;color:${TEXT_MUTED};padding-bottom:22px;">
            Nhập mã xác nhận bên dưới để đặt lại mật khẩu cho tài khoản của bạn.
          </td>
        </tr>
        <tr>
          <td align="center" style="background-color:${CODE_BG};border:1px dashed ${BRAND_AMBER};border-radius:12px;padding:20px 12px;">
            <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:32px;font-weight:700;letter-spacing:9px;color:${TEXT_DARK};-webkit-user-select:all;user-select:all;">${code}</div>
          </td>
        </tr>
        <tr>
          <td align="center" style="font-size:12px;color:${TEXT_MUTED};padding-top:10px;">
            Chạm giữ (hoặc bôi đen) dãy số để sao chép
          </td>
        </tr>
        <tr>
          <td style="font-size:14px;line-height:22px;color:${TEXT_DARK};padding-top:22px;">
            Mã có hiệu lực trong <strong>${ttlMinutes} phút</strong> và chỉ dùng được một lần.
          </td>
        </tr>
        <tr>
          <td style="padding:22px 0;">
            <div style="height:1px;background-color:${CARD_BORDER};line-height:1px;font-size:0;">&nbsp;</div>
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;line-height:21px;color:${TEXT_MUTED};">
            Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này — mật khẩu hiện tại vẫn an toàn.
            Nhân viên TryBuy không bao giờ hỏi mã này, đừng chia sẻ cho bất kỳ ai.
          </td>
        </tr>
      </table>
      <div style="max-width:480px;font-size:12px;color:${TEXT_MUTED};padding:16px 4px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
        Email tự động từ TryBuy — vui lòng không trả lời.
      </div>
    </td>
  </tr>
</table>`;

  return { subject, text, html };
}

/**
 * Order lifecycle mail — placed, paid, shipped, delivering, delivered,
 * canceled, and the three return outcomes.
 *
 * Deliberately ONE template for all of them: the notification message already
 * is the headline, so adding a lifecycle event needs no new template and no new
 * wording decision here. `orderLabel` is the `#ord_…` code the message embeds;
 * it is lifted out of the sentence and given its own row so the mail reads like
 * an order update rather than a log line.
 *
 * `actionUrl` is null when no storefront origin is configured — the mail then
 * renders without a button rather than with a dead link.
 */
export function renderOrderNotificationEmail(
  message: string,
  orderLabel: string,
  actionUrl: string | null,
): RenderedEmail {
  const subject = `TryBuy — ${message}`;

  const text = [
    `${message}.`,
    ``,
    `Mã đơn hàng: ${orderLabel}`,
    actionUrl
      ? `Xem chi tiết: ${actionUrl}`
      : `Xem chi tiết trong mục Đơn hàng của bạn trên TryBuy.`,
  ].join("\n");

  // The label sits inside the sentence ("Đơn hàng #ord_x đã được đặt thành
  // công"); removing it leaves a headline that reads on its own next to the
  // code row. A caller whose label is not in the message keeps the full
  // sentence — a slightly repeated code beats a mangled headline.
  const headline = escapeHtml(message.replace(` ${orderLabel}`, ""));
  const safeLabel = escapeHtml(orderLabel);
  const safeActionUrl = actionUrl === null ? null : escapeHtml(actionUrl);

  const ctaRow =
    safeActionUrl === null
      ? ""
      : `
        <tr>
          <td align="center" style="padding-top:24px;">
            <a href="${safeActionUrl}" style="display:inline-block;background-color:${BRAND_AMBER};color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none;padding:13px 30px;border-radius:10px;">
              Xem chi tiết đơn hàng
            </a>
          </td>
        </tr>`;

  const html = `<!-- preheader: shown as the inbox preview line, hidden in the body -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
${headline} — mã đơn ${safeLabel}
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#FFFFFF;border:1px solid ${CARD_BORDER};border-radius:14px;padding:32px 28px;">
        <tr>
          <td style="font-size:20px;font-weight:700;color:${BRAND_AMBER};letter-spacing:-0.3px;padding-bottom:20px;">
            TryBuy
          </td>
        </tr>
        <tr>
          <td style="font-size:19px;font-weight:700;line-height:27px;color:${TEXT_DARK};padding-bottom:10px;">
            ${headline}
          </td>
        </tr>
        <tr>
          <td style="font-size:14px;line-height:22px;color:${TEXT_MUTED};padding-bottom:22px;">
            Cảm ơn bạn đã mua sắm tại TryBuy. Bạn có thể theo dõi tình trạng đơn hàng bất cứ lúc nào.
          </td>
        </tr>
        <tr>
          <td style="background-color:${CODE_BG};border:1px solid ${CARD_BORDER};border-radius:12px;padding:16px 18px;">
            <div style="font-size:12px;color:${TEXT_MUTED};padding-bottom:6px;">Mã đơn hàng</div>
            <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:17px;font-weight:700;color:${TEXT_DARK};-webkit-user-select:all;user-select:all;">${safeLabel}</div>
          </td>
        </tr>${ctaRow}
        <tr>
          <td style="padding:22px 0;">
            <div style="height:1px;background-color:${CARD_BORDER};line-height:1px;font-size:0;">&nbsp;</div>
          </td>
        </tr>
        <tr>
          <td style="font-size:13px;line-height:21px;color:${TEXT_MUTED};">
            Bạn nhận được email này vì tài khoản TryBuy của bạn có hoạt động đơn hàng.
          </td>
        </tr>
      </table>
      <div style="max-width:480px;font-size:12px;color:${TEXT_MUTED};padding:16px 4px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
        Email tự động từ TryBuy — vui lòng không trả lời.
      </div>
    </td>
  </tr>
</table>`;

  return { subject, text, html };
}
