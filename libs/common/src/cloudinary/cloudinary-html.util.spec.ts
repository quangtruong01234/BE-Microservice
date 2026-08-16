import { extractCloudinaryUrlsFromHtml } from "./cloudinary-html.util";

const asset = (leaf: string): string =>
  `https://res.cloudinary.com/demo/image/upload/v1712345678/trybuy/products/${leaf}`;

describe("extractCloudinaryUrlsFromHtml (UP-03)", () => {
  it("returns [] for null/undefined/empty input", () => {
    expect(extractCloudinaryUrlsFromHtml(null)).toEqual([]);
    expect(extractCloudinaryUrlsFromHtml(undefined)).toEqual([]);
    expect(extractCloudinaryUrlsFromHtml("")).toEqual([]);
  });

  it("returns [] for HTML with no Cloudinary reference", () => {
    expect(
      extractCloudinaryUrlsFromHtml("<p>Áo thun cotton <b>100%</b></p>"),
    ).toEqual([]);
  });

  it("pulls the src of every embedded image, in order", () => {
    const html = `<p>Trên</p><img src="${asset("17_a.png")}"><p>Giữa</p><img src="${asset("17_b.jpg")}" alt="x">`;
    expect(extractCloudinaryUrlsFromHtml(html)).toEqual([
      asset("17_a.png"),
      asset("17_b.jpg"),
    ]);
  });

  it("de-duplicates the same asset embedded twice", () => {
    const html = `<img src="${asset("17_a.png")}"><img src="${asset("17_a.png")}">`;
    expect(extractCloudinaryUrlsFromHtml(html)).toEqual([asset("17_a.png")]);
  });

  it("stops at the closing quote — no markup bleeds into the URL", () => {
    const html = `<img src="${asset("17_a.png")}" class="w-full rounded">`;
    expect(extractCloudinaryUrlsFromHtml(html)).toEqual([asset("17_a.png")]);
  });

  it("handles single-quoted attributes and inline background-image", () => {
    const html = `<div style="background-image:url(${asset("17_bg.png")})"><img src='${asset("17_q.png")}'></div>`;
    expect(extractCloudinaryUrlsFromHtml(html)).toEqual([
      asset("17_bg.png"),
      asset("17_q.png"),
    ]);
  });

  it("strips trailing prose punctuation from a bare URL", () => {
    expect(
      extractCloudinaryUrlsFromHtml(`<p>Xem ảnh: ${asset("17_a.png")}.</p>`),
    ).toEqual([asset("17_a.png")]);
  });

  it("ignores foreign hosts — a lookalike domain is not ours", () => {
    const html =
      '<img src="https://res.cloudinary.com.evil.com/demo/image/upload/v1/trybuy/products/17_a.png">';
    expect(extractCloudinaryUrlsFromHtml(html)).toEqual([]);
  });
});
