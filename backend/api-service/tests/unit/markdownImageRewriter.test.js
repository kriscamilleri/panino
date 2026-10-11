import { afterEach, describe, expect, it } from "vitest";
import { rewriteCanonicalImageDestinations } from "../../markdownImageRewriter.js";

const sourceImage = "11111111-1111-4111-8111-111111111111";
const destinationImage = "22222222-2222-4222-8222-222222222222";
const sourceSpace = "33333333-3333-4333-8333-333333333333";
const destinationSpace = "44444444-4444-4444-8444-444444444444";
const user = "55555555-5555-4555-8555-555555555555";

describe("rewriteCanonicalImageDestinations", () => {
  it("rewrites inline, angle, and referenced canonical image destinations only", () => {
    const sourceUrl = `/images/${sourceImage}?space=${sourceSpace}`;
    const markdown = [
      `![inline](${sourceUrl} "title")`,
      `![angle](<${sourceUrl}>)`,
      "![reference][hero]",
      `[hero]: ${sourceUrl} 'caption'`,
      `[ordinary](${sourceUrl})`,
      `<img src="${sourceUrl}">`,
    ].join("\n");

    const result = rewriteCanonicalImageDestinations(markdown, {
      sourceDbKey: `space:${sourceSpace}`,
      destinationDbKey: `space:${destinationSpace}`,
      imageMap: { [sourceImage]: destinationImage },
    });
    const expectedUrl = `/images/${destinationImage}?space=${destinationSpace}`;

    expect(result.content).toContain(`![inline](${expectedUrl} "title")`);
    expect(result.content).toContain(`![angle](<${expectedUrl}>)`);
    expect(result.content).toContain(`[hero]: ${expectedUrl} 'caption'`);
    expect(result.content).toContain(`[ordinary](${sourceUrl})`);
    expect(result.content).toContain(`<img src="${sourceUrl}">`);
    expect(result.sourceImageIds).toEqual([sourceImage]);
  });

  it("preserves code, external, malformed, and unknown-parameter destinations byte-for-byte", () => {
    const canonical = `/images/${sourceImage}`;
    const markdown = [
      `\`![inline](${canonical})\``,
      "```md",
      `![fenced](${canonical})`,
      "```",
      `    ![indented](${canonical})`,
      `![external](https://example.test${canonical})`,
      `![protocol-relative](//example.test${canonical})`,
      `![query](${canonical}?v=2)`,
      `\\![escaped](${canonical})`,
      `![malformed](/images/not-a-uuid)`,
    ].join("\n");

    const result = rewriteCanonicalImageDestinations(markdown, {
      sourceDbKey: `user:${user}`,
      destinationDbKey: `space:${destinationSpace}`,
      imageMap: { [sourceImage]: destinationImage },
    });

    expect(result.content).toBe(markdown);
    expect(result.sourceImageIds).toEqual([]);
    expect(result.noncanonicalImageIds).toEqual([sourceImage]);
  });

  it("preserves a canonical missing image and reports it", () => {
    const markdown = `before ![missing](/images/${sourceImage}) after`;
    const result = rewriteCanonicalImageDestinations(markdown, {
      sourceDbKey: `user:${user}`,
      destinationDbKey: `space:${destinationSpace}`,
      imageMap: {},
    });

    expect(result.content).toBe(markdown);
    expect(result.sourceImageIds).toEqual([sourceImage]);
    expect(result.missingImageIds).toEqual([sourceImage]);
  });

  it("skips Markdown-looking content inside raw HTML blocks", () => {
    const canonical = `/images/${sourceImage}`;
    const markdown = [
      "<div>",
      `![not-markdown](${canonical})`,
      "</div>",
      "",
      `![markdown](${canonical})`,
    ].join("\n");
    const result = rewriteCanonicalImageDestinations(markdown, {
      sourceDbKey: `user:${user}`,
      destinationDbKey: `space:${destinationSpace}`,
      imageMap: { [sourceImage]: destinationImage },
    });
    expect(result.content).toContain(`![not-markdown](${canonical})`);
    expect(result.content).toContain(
      `![markdown](/images/${destinationImage}?space=${destinationSpace})`,
    );
  });

  describe("the link forms the editor actually writes", () => {
    const original = { ...process.env };
    afterEach(() => {
      for (const name of ["PUBLIC_API_BASE_URL", "FRONTEND_URL", "INTERNAL_API_URL"]) {
        if (original[name] === undefined) delete process.env[name];
        else process.env[name] = original[name];
      }
    });

    const move = (markdown, sourceDbKey, destinationDbKey) => rewriteCanonicalImageDestinations(markdown, {
      sourceDbKey,
      destinationDbKey,
      imageMap: { [sourceImage]: destinationImage },
    });

    it("rebinds the production form, /api/images/<id>, and keeps that form", () => {
      // The first version matched only "/images/<id>", which no frontend writes.
      // A transfer then copied no image, warned about nothing and said "complete".
      const result = move(`![shot](/api/images/${sourceImage})`, `user:${user}`, `space:${destinationSpace}`);

      expect(result.content).toBe(`![shot](/api/images/${destinationImage}?space=${destinationSpace})`);
      expect(result.sourceImageIds).toEqual([sourceImage]);
      expect(result.noncanonicalImageIds).toEqual([]);
    });

    it("rebinds the development form, an absolute link on the API's origin", () => {
      process.env.PUBLIC_API_BASE_URL = "http://localhost:8000";
      const result = move(`![shot](http://localhost:8000/images/${sourceImage})`, `user:${user}`, `space:${destinationSpace}`);

      expect(result.content).toBe(`![shot](http://localhost:8000/images/${destinationImage}?space=${destinationSpace})`);
      expect(result.sourceImageIds).toEqual([sourceImage]);
    });

    it("rebinds an absolute production link on the frontend's origin", () => {
      process.env.FRONTEND_URL = "https://panino.example";
      const result = move(
        `![shot](https://panino.example/api/images/${sourceImage}?space=${sourceSpace})`,
        `space:${sourceSpace}`,
        `user:${user}`,
      );

      expect(result.content).toBe(`![shot](https://panino.example/api/images/${destinationImage})`);
    });

    it("leaves an absolute link to an origin that is not this installation's", () => {
      process.env.FRONTEND_URL = "https://panino.example";
      const markdown = `![shot](https://elsewhere.example/api/images/${sourceImage})`;
      const result = move(markdown, `user:${user}`, `space:${destinationSpace}`);

      expect(result.content).toBe(markdown);
      expect(result.sourceImageIds).toEqual([]);
      expect(result.noncanonicalImageIds).toEqual([]);
    });

    it("drops a session token from a rebound link", () => {
      const result = move(`![shot](/api/images/${sourceImage}?token=secret)`, `user:${user}`, `space:${destinationSpace}`);

      expect(result.content).toBe(`![shot](/api/images/${destinationImage}?space=${destinationSpace})`);
      expect(result.content).not.toContain("secret");
    });

    it("leaves, and reports, an image that belongs to a different database than the source", () => {
      // A personal Document that embeds a space image, and the reverse.
      const inSpace = `![theirs](/api/images/${sourceImage}?space=${sourceSpace})`;
      const personal = move(inSpace, `user:${user}`, `space:${destinationSpace}`);
      expect(personal.content).toBe(inSpace);
      expect(personal.sourceImageIds).toEqual([]);
      expect(personal.noncanonicalImageIds).toEqual([sourceImage]);

      const bare = `![mine](/api/images/${sourceImage})`;
      const space = move(bare, `space:${sourceSpace}`, `user:${user}`);
      expect(space.content).toBe(bare);
      expect(space.noncanonicalImageIds).toEqual([sourceImage]);
    });

    it("matches ids written in upper case", () => {
      const result = move(`![shot](/api/images/${sourceImage.toUpperCase()})`, `user:${user}`, `space:${destinationSpace}`);
      expect(result.sourceImageIds).toEqual([sourceImage]);
      expect(result.content).toContain(destinationImage);
    });
  });

  describe("cost", () => {
    it("handles a megabyte of code spans and image links without stalling the process", () => {
      // Every statement in the API runs on one thread. This input took tens of
      // seconds when each match scanned every excluded range.
      const line = "`a` ![](x)\n";
      const markdown = line.repeat(Math.ceil((1024 * 1024) / line.length));
      const started = process.hrtime.bigint();

      const result = rewriteCanonicalImageDestinations(markdown, {
        sourceDbKey: `user:${user}`,
        destinationDbKey: `space:${destinationSpace}`,
      });

      const milliseconds = Number(process.hrtime.bigint() - started) / 1e6;
      expect(result.content).toBe(markdown);
      expect(milliseconds).toBeLessThan(3000);
    });

    it("handles one very long line of unterminated image openings", () => {
      const markdown = "![".repeat(200_000);
      const started = process.hrtime.bigint();

      rewriteCanonicalImageDestinations(markdown, {
        sourceDbKey: `user:${user}`,
        destinationDbKey: `space:${destinationSpace}`,
      });

      expect(Number(process.hrtime.bigint() - started) / 1e6).toBeLessThan(3000);
    });
  });
});
