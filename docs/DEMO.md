# Demo

| | |
|---|---|
| **Storefront** | https://fe-react-vite.quangtruong01234.workers.dev |
| **Shipping console** | https://web-flow-ghn.vercel.app |
| **API docs** | `/doc` on the deployed gateway (Swagger) |

> ⏰ **The backend runs 14:00–19:00 ICT (UTC+7) only.** This is a portfolio
> deployment on free-tier infrastructure, not a 24/7 service. Both frontends
> stay online outside that window, but they cannot load data — the EC2 instance
> is stopped. If you are reading this outside the window, the three flows below
> describe what the running system does, and the screenshots in the root
> [`README.md`](../README.md) show it.

---

## Accounts

These five accounts exist for this demo only. They hold no real data, the
payments behind them are sandbox payments, and they are reset whenever the seed
is re-run — please do not treat them as yours.

| # | Username | Password | Role | What it can do |
|---|---|---|---|---|
| 1 | `demo.buyer` | `DemoTryBuy!2026` | `user` | Browse, cart, checkout, pay, track, review, post |
| 2 | `demo.seller` | `DemoTryBuy!2026` | `shop` | Everything above, plus manage its own products, stock and orders |
| 3 | `demo.seller2` | `DemoTryBuy!2026` | `shop` | A second shop — shows multi-seller checkout splitting one cart into several orders |
| 4 | `demo.shipper` | `DemoTryBuy!2026` | `shipping_manager` | Shipping console: waybills, GHN sync, delivery history |
| 5 | `demo.admin` | `DemoTryBuy!2026` | `admin` | Role changes, moderation queue, platform vouchers, every order |

The role names are the literal values the API uses. There is no `shipping`
role — the shipping console is gated on `shipping_manager` (read + update) and
`logistics_operator` (read only).

Payments run against the **ZaloPay and VNPay sandboxes**. No real money moves;
use the test card details the sandbox shows on its own payment page.

---

## Flow 1 — Buying (≈4 minutes)

1. **Browse the catalog** as an anonymous visitor. Search with and without
   Vietnamese accents — `ao thun` finds *áo thun*. Note the product URL: it
   reads `prod_…`, never a database id.
2. **Log in as `demo.buyer`** and add two items to the cart, including one from
   a different shop. The cart keeps them together; checkout will not.
3. **Check out with a voucher.** The cart splits into one order per shop, the
   discount is apportioned across them, and stock is *reserved* rather than
   subtracted.
4. **Pay through the ZaloPay sandbox.** You are redirected out and back; the
   order moves to `PAID` when the webhook lands, not when the browser returns.
5. **Track the order.** Its status, the shipping fee quoted by GHN, and the
   estimated delivery date are all on the detail page, and an in-app
   notification arrives for each transition.

## Flow 2 — Selling (≈3 minutes)

1. **Log in as `demo.seller`** — the header switches to the seller area.
2. **Create a product with a SKU matrix** (say colour × size). Each combination
   gets its own price and stock row; the inventory service owns those rows in a
   separate PostgreSQL database.
3. **Watch the order from Flow 1 arrive** in the seller's order list, then
   confirm it. Only the items belonging to this shop are visible — the buyer's
   other order is not.
4. **Export orders to CSV** for a date range. One row per order item, with the
   order-level money columns written only on each order's first row, so summing
   a column does not double-count.

## Flow 3 — Shipping (≈3 minutes)

1. **Open the shipping console** and log in as `demo.shipper`. A `user` account
   is refused here — the console is role-gated, not merely hidden.
2. **Create a GHN waybill** for the confirmed order. The address is validated
   against GHN's province/district/ward tree before the waybill is requested.
3. **Sync the shipping status** and watch the history table fill in. The stored
   delivery estimate refreshes on this manual sync.
4. **Switch back to the storefront** as `demo.buyer`: the new status and its
   notification are already there.

---

## What to look at

Five things worth clicking on, because each one is a decision rather than a
default:

- **Double-click "Pay".** Submit the payment twice, or let the ZaloPay webhook
  arrive twice — the order is charged once. Every consumer is idempotent on the
  order id, because at-least-once delivery makes redelivery normal rather than
  exceptional.

- **Race the last unit.** Put the final item of a SKU in two browsers and check
  out in both. One succeeds, the other gets a clean "out of stock" — not a
  negative stock row. Checkout writes a reservation keyed by a UUID; it never
  decrements a counter.

- **The ids in the URL.** `ord_…`, `prod_…`, `usr_…`. Internal numeric keys
  never leave the gateway. Sequential ids leak volume and invite enumeration;
  these do not. They are not authorization — ownership is still checked after
  the id resolves — but a failed lookup stops being a discovery tool.

- **The payment webhook.** Replay it with a tampered signature (the route is in
  Swagger) and it is rejected. The order state changes on the signed callback,
  never on the browser redirect, because the redirect is under the buyer's
  control and the callback is not.

- **A role change mid-session.** As `demo.admin`, promote `demo.buyer` to
  `shop`. Nothing changes for that user until the next login — the role is baked
  into the JWT. `GET /api/user/me` surfaces the drift so the frontend can prompt
  a re-login, rather than the backend pretending the token says something it
  does not.

---
---

# Demo (Tiếng Việt)

| | |
|---|---|
| **Storefront** | https://fe-react-vite.quangtruong01234.workers.dev |
| **Console giao hàng** | https://web-flow-ghn.vercel.app |
| **Tài liệu API** | `/doc` trên gateway đã deploy (Swagger) |

> ⏰ **Backend chỉ chạy 14:00–19:00 giờ Việt Nam.** Đây là bản deploy cho
> portfolio trên hạ tầng free-tier, không phải dịch vụ 24/7. Hai frontend vẫn
> online ngoài khung giờ đó nhưng không tải được dữ liệu vì EC2 đã tắt. Nếu bạn
> đọc ngoài khung giờ, ba luồng bên dưới mô tả đúng những gì hệ thống làm khi
> chạy, còn ảnh chụp màn hình nằm ở [`README.md`](../README.md) gốc.

## Tài khoản

Năm tài khoản này chỉ dùng cho bản demo. Chúng không chứa dữ liệu thật, thanh
toán phía sau là sandbox, và sẽ bị xoá mỗi lần chạy lại seed — mong bạn đừng coi
chúng là tài khoản của mình.

| # | Tài khoản | Mật khẩu | Vai trò | Làm được gì |
|---|---|---|---|---|
| 1 | `demo.buyer` | `DemoTryBuy!2026` | `user` | Xem hàng, giỏ hàng, đặt, thanh toán, theo dõi, đánh giá, đăng bài |
| 2 | `demo.seller` | `DemoTryBuy!2026` | `shop` | Như trên, thêm quản lý sản phẩm, tồn kho và đơn của shop mình |
| 3 | `demo.seller2` | `DemoTryBuy!2026` | `shop` | Shop thứ hai — để thấy một giỏ hàng tách thành nhiều đơn theo shop |
| 4 | `demo.shipper` | `DemoTryBuy!2026` | `shipping_manager` | Console giao hàng: vận đơn, đồng bộ GHN, lịch sử giao |
| 5 | `demo.admin` | `DemoTryBuy!2026` | `admin` | Đổi vai trò, kiểm duyệt, voucher sàn, xem mọi đơn |

Tên vai trò ở đây là giá trị thật mà API dùng. Không có vai trò `shipping` —
console giao hàng chặn theo `shipping_manager` (đọc + ghi) và
`logistics_operator` (chỉ đọc).

Thanh toán chạy trên **sandbox ZaloPay và VNPay** — không có tiền thật. Dùng
thông tin thẻ test mà trang thanh toán sandbox hiển thị.

## Luồng 1 — Mua hàng (~4 phút)

1. **Duyệt danh mục** khi chưa đăng nhập. Tìm có dấu và không dấu đều ra kết quả
   — `ao thun` vẫn tìm thấy *áo thun*. Để ý URL sản phẩm: là `prod_…`, không
   phải id trong database.
2. **Đăng nhập `demo.buyer`**, thêm hai sản phẩm vào giỏ, trong đó một sản phẩm
   thuộc shop khác. Giỏ giữ chung, nhưng đặt hàng thì không.
3. **Đặt hàng kèm voucher.** Giỏ tách thành mỗi shop một đơn, giảm giá được phân
   bổ theo từng đơn, và tồn kho được *giữ chỗ* chứ không bị trừ.
4. **Thanh toán qua sandbox ZaloPay.** Bạn được chuyển đi rồi quay lại; đơn
   chuyển sang `PAID` khi webhook về, không phải khi trình duyệt quay lại.
5. **Theo dõi đơn.** Trạng thái, phí ship GHN báo về và ngày giao dự kiến đều
   nằm ở trang chi tiết, kèm thông báo in-app cho mỗi lần chuyển trạng thái.

## Luồng 2 — Bán hàng (~3 phút)

1. **Đăng nhập `demo.seller`** — header đổi sang khu vực người bán.
2. **Tạo sản phẩm có ma trận SKU** (ví dụ màu × size). Mỗi tổ hợp có giá và dòng
   tồn kho riêng; các dòng đó do service inventory sở hữu, nằm trong một
   database PostgreSQL tách biệt.
3. **Xem đơn ở Luồng 1 xuất hiện** trong danh sách đơn của shop rồi xác nhận.
   Chỉ thấy phần hàng của shop này — đơn kia của người mua không hiện ra.
4. **Xuất CSV** theo khoảng ngày. Mỗi dòng là một order item, còn các cột tiền
   cấp đơn chỉ ghi ở dòng đầu tiên của mỗi đơn, nên cộng cột không bị tính trùng.

## Luồng 3 — Giao hàng (~3 phút)

1. **Mở console giao hàng**, đăng nhập `demo.shipper`. Tài khoản `user` bị từ
   chối — console chặn theo vai trò, không chỉ ẩn giao diện.
2. **Tạo vận đơn GHN** cho đơn vừa xác nhận. Địa chỉ được kiểm tra theo cây
   tỉnh/quận/phường của GHN trước khi gọi tạo vận đơn.
3. **Đồng bộ trạng thái** và xem bảng lịch sử được điền dần. Ngày giao dự kiến
   lưu trong hệ thống được làm mới đúng ở bước sync thủ công này.
4. **Quay lại storefront** với `demo.buyer`: trạng thái mới và thông báo đã có
   sẵn ở đó.

## Nên xem kỹ chỗ nào

Năm chỗ đáng bấm thử, vì mỗi chỗ là một quyết định thiết kế chứ không phải mặc
định của framework:

- **Bấm "Thanh toán" hai lần.** Gửi thanh toán hai lần, hoặc để webhook ZaloPay
  về hai lần — đơn vẫn chỉ bị tính tiền một lần. Mọi consumer đều idempotent
  theo order id, vì với at-least-once thì gửi lại là chuyện bình thường.

- **Tranh nhau món cuối cùng.** Mở sản phẩm còn đúng 1 tồn kho ở hai trình duyệt
  rồi đặt cùng lúc. Một đơn thành công, đơn kia báo hết hàng rõ ràng — không có
  tồn kho âm. Đặt hàng ghi một bản ghi giữ chỗ theo UUID, không trừ vào bộ đếm.

- **Id trên URL.** `ord_…`, `prod_…`, `usr_…`. Khoá số nội bộ không bao giờ ra
  khỏi gateway. Id tuần tự làm lộ quy mô và mời gọi dò tìm; id này thì không. Nó
  không thay cho phân quyền — quyền sở hữu vẫn được kiểm tra sau khi giải mã id
  — nhưng một lần tra cứu hụt không còn là công cụ dò dữ liệu.

- **Webhook thanh toán.** Gửi lại với chữ ký sai (route có trong Swagger) thì bị
  từ chối. Trạng thái đơn đổi theo callback đã ký, không đổi theo redirect trình
  duyệt, vì redirect nằm trong tay người mua còn callback thì không.

- **Đổi vai trò giữa phiên.** Dùng `demo.admin` nâng `demo.buyer` lên `shop`.
  Người dùng đó không thấy gì thay đổi cho tới lần đăng nhập kế tiếp — vai trò
  nằm trong JWT. `GET /api/user/me` phơi ra chênh lệch này để frontend mời đăng
  nhập lại, thay vì backend giả vờ rằng token đang nói điều nó không nói.
