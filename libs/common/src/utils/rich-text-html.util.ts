/**
 * Allow-list sanitizer for rich-text HTML written by the frontend
 * RichTextEditor (tiptap StarterKit + Image) — product `description` today.
 *
 * The storefront renders that HTML raw (`dangerouslySetInnerHTML`), so anything
 * a seller can store runs in every buyer's browser (XSS-DESC-01). It is cleaned
 * on WRITE, so every consumer of the column gets the safe value.
 *
 * Strategy: parse and REBUILD, never filter-in-place. The output contains only
 * (a) text with `<` and `>` escaped, and (b) tags from the allow-list, re-emitted
 * by this function with allow-listed attributes whose values are re-escaped. A
 * parser differential between this scanner and a browser can therefore only
 * mangle content, never smuggle markup: the browser only ever sees markup this
 * function wrote itself.
 *
 * Dependency-free on purpose: `npm install` is denied in this repo, and a DOM
 * implementation (DOMPurify + jsdom) is far heavier than the ~16 tags the
 * editor can emit.
 */

// Tags the editor emits: StarterKit (paragraph, heading 1-6, marks, lists,
// blockquote, code block, hard break, horizontal rule, link) + Image.
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "hr",
  "a",
  "img",
]);

const VOID_TAGS = new Set(["br", "hr", "img"]);

// Disallowed tags whose CONTENT must go too — keeping the text of a <script> or
// <style> would print source code into the page.
const DROP_CONTENT_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "noembed",
  "noframes",
  "template",
  "textarea",
  "title",
  "xmp",
  "plaintext",
  "svg",
  "math",
  "select",
]);

// A tag longer than this is treated as text. Bounds the per-`<` scan so an
// input full of unterminated tags stays linear instead of quadratic.
const MAX_TAG_LENGTH = 2048;

const TAG_NAME_PATTERN = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/;
const ATTRIBUTE_PATTERN =
  /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const TEXT_ENTITY_PATTERN =
  /^&(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{0,31});/;
const LANGUAGE_CLASS_PATTERN = /^language-[\w-]{1,32}$/;
const DIGITS_PATTERN = /^\d{1,6}$/;
const HREF_PATTERN = /^(?:https?:|mailto:|tel:|\/|#)/i;
const IMAGE_SRC_PATTERN = /^https?:\/\//i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function escapeText(text: string): string {
  let escaped = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "<") {
      escaped += "&lt;";
    } else if (char === ">") {
      escaped += "&gt;";
    } else if (char === "&") {
      // Keep a well-formed entity as-is (the editor already writes `&amp;`,
      // `&nbsp;`) — in text content it can only ever decode to text.
      const entity = TEXT_ENTITY_PATTERN.exec(text.slice(index, index + 40));
      if (entity) {
        escaped += entity[0];
        index += entity[0].length - 1;
      } else {
        escaped += "&amp;";
      }
    } else {
      escaped += char;
    }
  }
  return escaped;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Decodes numeric entities and the handful of named ones the editor writes.
 * An unknown named entity stays literal — and since the value is re-escaped on
 * output, the browser then sees it literally too, so the string validated here
 * is exactly the string the browser uses (`javascript&colon;` never passes the
 * scheme check, and never decodes to `javascript:` either).
 */
function decodeAttribute(value: string): string {
  return value.replace(
    /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]+);?/g,
    (match: string, reference: string) => {
      if (reference.startsWith("#")) {
        const isHex = reference[1] === "x" || reference[1] === "X";
        const codePoint = Number.parseInt(
          reference.slice(isHex ? 2 : 1),
          isHex ? 16 : 10,
        );
        return codePoint > 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : "";
      }
      return NAMED_ENTITIES[reference] ?? match;
    },
  );
}

// Browsers strip leading/trailing C0 controls + spaces and every tab/newline
// from a URL before resolving its scheme; validate that same string.
function normalizeUrl(value: string): string {
  const url = value.replace(/[\t\n\r]/g, "");
  const isControlOrSpace = (index: number): boolean =>
    url.charCodeAt(index) <= 0x20;
  let start = 0;
  let end = url.length;
  while (start < end && isControlOrSpace(start)) start++;
  while (end > start && isControlOrSpace(end - 1)) end--;
  return url.slice(start, end);
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    // First occurrence wins, as in the HTML parser.
    if (attributes.has(name)) continue;
    attributes.set(
      name,
      decodeAttribute(match[2] ?? match[3] ?? match[4] ?? ""),
    );
  }
  return attributes;
}

function buildAttributes(
  tagName: string,
  attributes: Map<string, string>,
): string {
  const kept: [string, string][] = [];
  const keepIf = (name: string, isValid: (value: string) => boolean): void => {
    const value = attributes.get(name);
    if (value !== undefined && isValid(value)) kept.push([name, value]);
  };

  if (tagName === "a") {
    const href = normalizeUrl(attributes.get("href") ?? "");
    if (HREF_PATTERN.test(href)) kept.push(["href", href]);
    if (attributes.get("target") === "_blank") kept.push(["target", "_blank"]);
    // User-generated links: never pass the opener or ranking signal.
    kept.push(["rel", "noopener noreferrer nofollow"]);
  } else if (tagName === "img") {
    const src = normalizeUrl(attributes.get("src") ?? "");
    // An image without a safe source is dropped entirely by the caller.
    if (!IMAGE_SRC_PATTERN.test(src)) return "";
    kept.push(["src", src]);
    keepIf("alt", () => true);
    keepIf("title", () => true);
    keepIf("width", (value) => DIGITS_PATTERN.test(value));
    keepIf("height", (value) => DIGITS_PATTERN.test(value));
  } else if (tagName === "ol") {
    keepIf("start", (value) => DIGITS_PATTERN.test(value));
  } else if (tagName === "code") {
    keepIf("class", (value) => LANGUAGE_CLASS_PATTERN.test(value));
  }

  return kept
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
}

/**
 * Returns the end index (exclusive) of the tag starting at `start`, honouring
 * quoted attribute values, or -1 when there is no well-formed end in range.
 */
function findTagEnd(html: string, start: number): number {
  const limit = Math.min(html.length, start + MAX_TAG_LENGTH);
  let quote: string | null = null;
  for (let index = start + 1; index < limit; index++) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index + 1;
    }
  }
  return -1;
}

/**
 * The form a plain-text keyword takes inside stored rich text: the editor and
 * this sanitizer entity-escape `&`, `<` and `>` in text (quotes stay literal).
 * Used to make a `LIKE` over the HTML column match `R&D` stored as `R&amp;D`.
 */
export function escapeRichTextSearchTerm(term: string): string {
  return term
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Sanitizes rich-text HTML to the editor's allow-list. Idempotent:
 * `sanitizeRichTextHtml(sanitizeRichTextHtml(x)) === sanitizeRichTextHtml(x)`.
 */
export function sanitizeRichTextHtml(html: string): string {
  const source = html.split("\0").join("");
  // Without a `<` the browser's tokenizer never leaves text state — `&…;` only
  // decodes to text — so nothing here can become markup. Store plain text as
  // sent: escaping `R&D` to `R&amp;D` would break a LIKE search for "R&D".
  if (!source.includes("<")) {
    return source;
  }
  const output: string[] = [];
  const openTags: string[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart === -1) {
      output.push(escapeText(source.slice(cursor)));
      break;
    }
    output.push(escapeText(source.slice(cursor, tagStart)));

    // Comments, CDATA, doctype, processing instructions — dropped.
    if (source.startsWith("<!--", tagStart)) {
      const commentEnd = source.indexOf("-->", tagStart + 4);
      cursor = commentEnd === -1 ? source.length : commentEnd + 3;
      continue;
    }
    const nextChar = source[tagStart + 1];
    if (nextChar === "!" || nextChar === "?") {
      const declarationEnd = source.indexOf(">", tagStart);
      cursor = declarationEnd === -1 ? source.length : declarationEnd + 1;
      continue;
    }

    const nameMatch = TAG_NAME_PATTERN.exec(
      source.slice(tagStart, tagStart + 64),
    );
    const tagEnd = nameMatch ? findTagEnd(source, tagStart) : -1;
    if (!nameMatch || tagEnd === -1) {
      // Not a tag — a literal `<` in prose.
      output.push("&lt;");
      cursor = tagStart + 1;
      continue;
    }

    const isClosing = nameMatch[1] === "/";
    const tagName = nameMatch[2].toLowerCase();
    cursor = tagEnd;

    if (!isClosing && DROP_CONTENT_TAGS.has(tagName)) {
      const closePattern = new RegExp(`</${tagName}[\\s/>]`, "ig");
      closePattern.lastIndex = tagEnd;
      const closeMatch = closePattern.exec(source);
      if (!closeMatch) {
        cursor = source.length;
      } else {
        const closeEnd = source.indexOf(">", closeMatch.index);
        cursor = closeEnd === -1 ? source.length : closeEnd + 1;
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(tagName)) {
      // Unknown wrapper (<span>, <div>, <font>…): drop the tag, keep its text.
      continue;
    }

    if (isClosing) {
      const openIndex = openTags.lastIndexOf(tagName);
      if (openIndex === -1) continue;
      while (openTags.length > openIndex) {
        output.push(`</${openTags.pop()}>`);
      }
      continue;
    }

    const attributeSource = source.slice(
      tagStart + nameMatch[0].length,
      tagEnd - 1,
    );
    const attributes = buildAttributes(
      tagName,
      parseAttributes(attributeSource),
    );
    if (tagName === "img" && attributes === "") {
      continue;
    }
    output.push(`<${tagName}${attributes}>`);
    if (!VOID_TAGS.has(tagName)) {
      openTags.push(tagName);
    }
  }

  while (openTags.length > 0) {
    output.push(`</${openTags.pop()}>`);
  }
  return output.join("");
}

// Tags that end a line of text when rich text is flattened.
const BLOCK_TAG_PATTERN =
  /<\/?(?:p|h[1-6]|li|ul|ol|blockquote|pre|hr|div|tr|table)\b[^>]*>/gi;
const LINE_BREAK_TAG_PATTERN = /<br\s*\/?>/gi;
const DROPPED_BLOCK_PATTERN = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const ANY_TAG_PATTERN = /<[^>]*>/g;

/**
 * Flattens rich-text HTML into plain text: one line per block (paragraph,
 * heading, list item, `<br>`), tags stripped, basic entities decoded, blank
 * lines dropped. Used to feed a product description to the RAG index
 * (PRODUCT-QA-01) — the output is text, never rendered as HTML.
 */
export function htmlToPlainText(html: string): string {
  const withLineBreaks = html
    .replace(DROPPED_BLOCK_PATTERN, "\n")
    .replace(LINE_BREAK_TAG_PATTERN, "\n")
    .replace(BLOCK_TAG_PATTERN, "\n")
    .replace(ANY_TAG_PATTERN, "");
  return (
    decodeAttribute(withLineBreaks)
      .split("\n")
      // `\s` covers the no-break space a decoded `&nbsp;` leaves.
      .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n")
  );
}
