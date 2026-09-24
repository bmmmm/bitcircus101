/**
 * Vendored third-party code is pinned byte for byte.
 * Runs with: node --test tests/vendor.spec.mjs
 *
 * qrcode-generator draws the QR codes on the kiosk's pinnwand page. It is
 * self-hosted (no CDN call from the wall), so nothing but this test notices a
 * stray edit, a reformat or a swapped file. The provenance — tarball, upstream
 * hash, how it was minified — sits in the file's own header; a deliberate
 * re-vendor updates the header, NOTICE and the hash below together.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);

const PINNED = {
    "qrcode-generator-2.0.4.min.js":
        "92518aaaee9b905d7cd6066abc33aec2c9b31b85bab4e0829007bc8755a408b9",
};

describe("vendored files", () => {
    for (const [file, sha] of Object.entries(PINNED)) {
        it(`${file} matches its pinned SHA-256`, () => {
            const got = createHash("sha256").update(readFileSync(new URL(file, ROOT))).digest("hex");
            assert.equal(got, sha, `${file} changed — re-vendor deliberately or restore it`);
        });
    }

    it("the kiosk loads exactly the pinned QR generator", () => {
        const html = readFileSync(new URL("kiosk/index.html", ROOT), "utf8");
        assert.match(html, /<script defer src="\.\.\/qrcode-generator-2\.0\.4\.min\.js"><\/script>/);
    });
});
