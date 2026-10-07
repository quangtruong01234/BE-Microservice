import type { ProductRagSource } from "../types/product-index-changed-event";
import {
  bm25Scores,
  buildChunks,
  cleanWhitespace,
  contentHash,
  cutSnippet,
  reciprocalRankFusion,
  renumberCitations,
  scrubPii,
  stripMarkdown,
  tokenize,
} from "./rag-text.util";

const LONE_SURROGATE_PATTERN =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function makeSource(
  overrides: Partial<ProductRagSource> = {},
): ProductRagSource {
  return {
    productId: 7,
    publicId: "prod_8fK2mQ7aLp3xRt9Z",
    name: "Balo chống sốc",
    descriptionText: "Ngăn chính vừa laptop 15.6 inch.\n\nVải chống nước.",
    isActive: true,
    skus: [
      { label: "Màu: Đen", price: 1200000 },
      { label: "Màu: Xám", price: 1250000 },
    ],
    reviews: [
      { comment: "Rất tốt, gọi 0912345678 nhé", rating: 5 },
      { comment: "Khoá kéo hơi cứng", rating: 4 },
    ],
    ...overrides,
  };
}

describe("rag-text util (PRODUCT-QA-01)", () => {
  it("[TC-1] tokenize lowercases, strips diacritics and đ→d, splits on non-alphanumerics", () => {
    expect(tokenize("Pin sạc ĐƯỢC 20.000mAh!")).toEqual([
      "pin",
      "sac",
      "duoc",
      "20",
      "000mah",
    ]);
    expect(tokenize("")).toEqual([]);
    expect(tokenize("  --  ")).toEqual([]);
  });

  it("[TC-2] bm25Scores ranks the chunk with the rarer matching term higher and returns all zeros when no query term occurs", () => {
    const documents = [
      ["pin", "sac", "nhanh"],
      ["pin", "ben"],
      ["vai", "ben", "dep", "nhe"],
    ];
    const scores = bm25Scores(["sac", "ben"], documents);
    expect(scores.map((score) => Number(score.toFixed(4)))).toEqual([
      0.9808, 0.5442, 0.4136,
    ]);
    // A repeated query term is counted once.
    expect(bm25Scores(["sac", "sac", "ben"], documents)).toEqual(scores);
    expect(bm25Scores(["xyz"], documents)).toEqual([0, 0, 0]);
    expect(bm25Scores([], documents)).toEqual([0, 0, 0]);
    expect(bm25Scores(["pin"], [])).toEqual([]);
  });

  it("[TC-3] reciprocalRankFusion uses k=60, gives zero-BM25 chunks no BM25 rank, breaks ties by vector rank then id, keeps 6", () => {
    const fused = reciprocalRankFusion({
      vectorRankedIds: [10, 20, 30, 40, 50, 60, 70, 80],
      bm25ScoreById: new Map([
        [30, 2],
        [99, 1],
        [10, 0.5],
        [20, 0],
      ]),
    });
    // 10 and 30 both score 1/61 + 1/63 → the better vector rank (10) wins.
    // 20 (vector rank 2 only — its BM25 0 gives no rank) ties 99 (BM25 rank 2
    // only) at 1/62 → 20 has a vector rank, 99 has none.
    expect(fused).toEqual([10, 30, 20, 99, 40, 50]);
    // Equal BM25 scores take their BM25 rank by id, so the lower id wins.
    expect(
      reciprocalRankFusion({
        vectorRankedIds: [],
        bm25ScoreById: new Map([
          [8, 1],
          [3, 1],
        ]),
      }),
    ).toEqual([3, 8]);
    // The higher BM25 score takes the better BM25 rank.
    expect(
      reciprocalRankFusion({
        vectorRankedIds: [],
        bm25ScoreById: new Map([
          [1, 0.5],
          [2, 3],
        ]),
      }),
    ).toEqual([2, 1]);
    expect(
      reciprocalRankFusion({ vectorRankedIds: [], bm25ScoreById: new Map() }),
    ).toEqual([]);
  });

  it("[TC-4] renumberCitations maps S-labels to [n] by first appearance and neutralises every other bracketed number", () => {
    expect(renumberCitations("A [S3] b [S1] c [S3].", 6)).toEqual({
      text: "A [1] b [2] c [1].",
      order: [3, 1],
    });
    expect(renumberCitations("Both [S1, S3] here", 6)).toEqual({
      text: "Both [1][2] here",
      order: [1, 3],
    });
    expect(renumberCitations("Gone [S9] and kept [S2]", 6)).toEqual({
      text: "Gone  and kept [1]",
      order: [2],
    });
    expect(renumberCitations("Made in [2024], see [1]", 6)).toEqual({
      text: "Made in (2024), see (1)",
      order: [],
    });
    expect(renumberCitations("A [note] stays", 6)).toEqual({
      text: "A [note] stays",
      order: [],
    });
    expect(renumberCitations("Nothing [S7][S0]", 6)).toEqual({
      text: "Nothing ",
      order: [],
    });
  });

  it('[TC-5] stripMarkdown removes bold/italic/headings/code/links/images/blockquotes, turns * and + bullets into "- ", leaves snake_case and "- " bullets intact', () => {
    const markdown = [
      "# Title",
      "**Bold** and *it* and _em_ and __strong__ with snake_case_name",
      "> quoted",
      "* item one",
      "+ item two",
      "- item three",
      "Use `code` and ![alt](http://x/y.png) and [link](http://x)",
      "```js",
      "const a = 1;",
      "```",
    ].join("\n");
    expect(stripMarkdown(markdown)).toBe(
      [
        "Title",
        "Bold and it and em and strong with snake_case_name",
        "quoted",
        "- item one",
        "- item two",
        "- item three",
        "Use code and alt and link",
        "const a = 1;",
        "",
      ].join("\n"),
    );
    expect(stripMarkdown("Có [S1] nhé")).toBe("Có [S1] nhé");
  });

  it("[TC-6] cleanWhitespace collapses \\n{3,} to one blank line, removes space before punctuation and trims", () => {
    expect(cleanWhitespace("  Có  [1] .\r\n\n\n\n- a  \t b , c\n  ")).toBe(
      "Có [1].\n\n- a b, c",
    );
    expect(cleanWhitespace("a\n\n\nb")).toBe("a\n\nb");
    expect(cleanWhitespace("a\n\nb")).toBe("a\n\nb");
  });

  it('[TC-7] cutSnippet returns ≤300 code points unchanged; a longer string becomes ≤300 code points ending in "…", cut at whitespace inside the last 40, never splitting a surrogate pair', () => {
    const exact = "a".repeat(300);
    expect(cutSnippet(exact)).toBe(exact);

    const words = "word ".repeat(100);
    const cutWords = cutSnippet(words);
    expect(Array.from(cutWords).length).toBeLessThanOrEqual(300);
    expect(cutWords.endsWith("word…")).toBe(true);

    const noSpace = "b".repeat(400);
    expect(cutSnippet(noSpace)).toBe(`${"b".repeat(299)}…`);

    const emoji = "😀".repeat(400);
    const cutEmoji = cutSnippet(emoji);
    expect(Array.from(cutEmoji)).toHaveLength(300);
    expect(LONE_SURROGATE_PATTERN.test(cutEmoji)).toBe(false);
  });

  it("[TC-8] scrubPii replaces phones and emails, keeps sizes, prices and years", () => {
    for (const phone of [
      "0912345678",
      "0912 345 678",
      "0912.345.678",
      "+84 912 345 678",
    ]) {
      expect(scrubPii(`gọi ${phone} nhé`)).toBe("gọi [phone] nhé");
    }
    expect(scrubPii("mail a@b.vn nhé")).toBe("mail [email] nhé");
    const kept = "vừa 15.6 inch, giá 199000 hoặc 1.200.000đ, năm 2024";
    expect(scrubPii(kept)).toBe(kept);
  });

  it("[TC-9] buildChunks orders PRODUCT, SKU, REVIEW (newest first), caps at 100, scrubs PII before hashing; contentHash is stable for equal input and changes with the embed model", () => {
    const chunks = buildChunks(makeSource());
    expect(chunks.map((chunk) => chunk.source)).toEqual([
      "PRODUCT",
      "SKU",
      "REVIEW",
      "REVIEW",
    ]);
    expect(chunks[0].content).toBe(
      "Balo chống sốc\nNgăn chính vừa laptop 15.6 inch.\nVải chống nước.",
    );
    expect(chunks[1].content).toBe(
      "Màu: Đen — 1.200.000 ₫\nMàu: Xám — 1.250.000 ₫",
    );
    expect(chunks[2].content).toBe("Rating 5/5: Rất tốt, gọi [phone] nhé");
    expect(chunks[3].content).toBe("Rating 4/5: Khoá kéo hơi cứng");

    const manyReviews = Array.from({ length: 150 }, (_, index) => ({
      comment: `review ${index}`,
      rating: 5,
    }));
    const capped = buildChunks(makeSource({ reviews: manyReviews }));
    expect(capped).toHaveLength(100);
    // Newest first, so the cap drops the oldest reviews.
    expect(capped[capped.length - 1].content).toBe("Rating 5/5: review 97");

    const longParagraph = Array.from({ length: 300 }, () => "chữ").join(" ");
    const split = buildChunks(
      makeSource({ descriptionText: longParagraph, skus: [], reviews: [] }),
    );
    expect(split.length).toBeGreaterThan(1);
    for (const chunk of split) {
      expect(Array.from(chunk.content).length).toBeLessThanOrEqual(700);
    }

    const hash = contentHash(chunks, "gemini-embedding-2", 768);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      contentHash(buildChunks(makeSource()), "gemini-embedding-2", 768),
    ).toBe(hash);
    expect(contentHash(chunks, "another-model", 768)).not.toBe(hash);
    const otherPhone = makeSource({
      reviews: [
        { comment: "Rất tốt, gọi 0987654321 nhé", rating: 5 },
        { comment: "Khoá kéo hơi cứng", rating: 4 },
      ],
    });
    expect(
      contentHash(buildChunks(otherPhone), "gemini-embedding-2", 768),
    ).toBe(hash);
  });
});
