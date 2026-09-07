"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  APPROVED_RESOLVER_BASE,
  constructCandidateImageUrl,
  assignImageEvidenceType,
  verifyImageReachability,
} = require("../api/_lib/image-contract.cjs");

test("Phase 4: Image Contract Verification", async (t) => {
  await t.test("1. valid key constructs deterministic DigitalOcean Spaces full URL", () => {
    const key = "67be7262617e0_front_image.jpg";
    const url = constructCandidateImageUrl(key);
    assert.equal(url, `${APPROVED_RESOLVER_BASE}67be7262617e0_front_image.jpg`);
    assert.match(url, /^https:\/\/thecollective-prod\.nyc3\.digitaloceanspaces\.com\/listings\/full\//);

    const type = assignImageEvidenceType({
      imageKey: key,
      candidateUrl: url,
      hasSourceLineage: true,
      isReachable: true,
      isBundle: false,
    });
    assert.equal(type, "SOURCE_LINKED_IMAGE");
  });

  await t.test("2. missing key returns null URL and NO_IMAGE evidence", () => {
    assert.equal(constructCandidateImageUrl(null), null);
    assert.equal(constructCandidateImageUrl(""), null);
    assert.equal(constructCandidateImageUrl("   "), null);
    assert.equal(constructCandidateImageUrl(undefined), null);

    const type = assignImageEvidenceType({
      imageKey: null,
      candidateUrl: null,
      hasSourceLineage: true,
      isReachable: true,
      isBundle: false,
    });
    assert.equal(type, "NO_IMAGE");
  });

  await t.test("3. traversal characters (../, backslashes, etc.) are strictly rejected", () => {
    assert.equal(constructCandidateImageUrl("../secret.jpg"), null);
    assert.equal(constructCandidateImageUrl("images/../../etc/passwd"), null);
    assert.equal(constructCandidateImageUrl("..\\windows\\win.ini"), null);
    assert.equal(constructCandidateImageUrl("foo/bar/.."), null);
  });

  await t.test("4. query-string and fragment characters (? and #) are strictly rejected", () => {
    assert.equal(constructCandidateImageUrl("photo.jpg?token=secret"), null);
    assert.equal(constructCandidateImageUrl("photo.jpg#anchor"), null);
    assert.equal(constructCandidateImageUrl("photo.jpg?v=123"), null);
  });

  await t.test("5. Unicode characters in image key are correctly URL-encoded", () => {
    const key = "手表_5712_front.jpg";
    const url = constructCandidateImageUrl(key);
    assert.ok(url);
    assert.ok(url.includes("%E6%89%8B%E8%A1%A8"));
    assert.equal(decodeURIComponent(url), `${APPROVED_RESOLVER_BASE}${key}`);
  });

  await t.test("6. 404 response in reachability check yields reachable = false and NO_IMAGE", async () => {
    const mockFetch = async () => ({
      status: 404,
      headers: { get: () => null },
    });

    const reachHead = await verifyImageReachability("https://example.com/notfound.jpg", {
      method: "HEAD",
      fetchFn: mockFetch,
    });
    assert.equal(reachHead.reachable, false);
    assert.equal(reachHead.status, 404);

    const reachGet = await verifyImageReachability("https://example.com/notfound.jpg", {
      method: "GET",
      fetchFn: mockFetch,
    });
    assert.equal(reachGet.reachable, false);
    assert.equal(reachGet.status, 404);

    const type = assignImageEvidenceType({
      imageKey: "missing.jpg",
      candidateUrl: `${APPROVED_RESOLVER_BASE}missing.jpg`,
      hasSourceLineage: true,
      isReachable: false,
      isBundle: false,
    });
    assert.equal(type, "NO_IMAGE");
  });

  await t.test("7. non-image content-type (e.g. text/html) yields reachable = false and NO_IMAGE", async () => {
    const mockFetch = async () => ({
      status: 200,
      headers: {
        get: (name) => (name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null),
      },
    });

    const reach = await verifyImageReachability("https://example.com/notimage", {
      method: "HEAD",
      fetchFn: mockFetch,
    });
    assert.equal(reach.reachable, false);
    assert.equal(reach.status, 200);

    const type = assignImageEvidenceType({
      imageKey: "page.html",
      candidateUrl: `${APPROVED_RESOLVER_BASE}page.html`,
      hasSourceLineage: true,
      isReachable: reach.reachable,
      isBundle: false,
    });
    assert.equal(type, "NO_IMAGE");
  });

  await t.test("8. wrong source lineage forces NO_IMAGE even if URL is constructed", () => {
    const key = "sample.jpg";
    const url = constructCandidateImageUrl(key);

    const type = assignImageEvidenceType({
      imageKey: key,
      candidateUrl: url,
      hasSourceLineage: false, // Lineage unproven
      isReachable: true,
      isBundle: false,
    });
    assert.equal(type, "NO_IMAGE");
  });

  await t.test("9. bundle parent with source attachment is PARENT_ATTACHMENT_UNASSIGNED_TO_CHILD (never NO_IMAGE)", () => {
    const key = "bundle_cover.jpg";
    const url = constructCandidateImageUrl(key);

    const type = assignImageEvidenceType({
      imageKey: key,
      candidateUrl: url,
      hasSourceLineage: true,
      isReachable: true,
      isBundle: true,
      isChild: false,
    });
    assert.equal(type, "PARENT_ATTACHMENT_UNASSIGNED_TO_CHILD");
  });

  await t.test("10. child with confirmed assignment receives ASSIGNED_CHILD_IMAGE", () => {
    const key = "child_watch.jpg";
    const url = constructCandidateImageUrl(key);

    const type = assignImageEvidenceType({
      imageKey: key,
      candidateUrl: url,
      hasSourceLineage: true,
      isReachable: true,
      isBundle: true,
      isChild: true,
      childAssigned: true,
      parentHasAttachment: true,
    });
    assert.equal(type, "ASSIGNED_CHILD_IMAGE");
  });

  await t.test("11. child without assignment where parent had attachment receives CHILD_UNASSIGNED_IMAGE", () => {
    const type = assignImageEvidenceType({
      imageKey: null,
      candidateUrl: null,
      hasSourceLineage: true,
      isReachable: null,
      isBundle: true,
      isChild: true,
      childAssigned: false,
      parentHasAttachment: true,
    });
    assert.equal(type, "CHILD_UNASSIGNED_IMAGE");
  });

  await t.test("12. supports both HEAD and GET reachability probes with image content-type", async () => {
    const mockFetchImage = async (url, { method }) => ({
      status: 200,
      headers: {
        get: (name) => {
          if (name.toLowerCase() === "content-type") return "image/jpeg";
          if (name.toLowerCase() === "content-length") return "102400";
          return null;
        },
      },
    });

    const headResult = await verifyImageReachability(`${APPROVED_RESOLVER_BASE}valid.jpg`, {
      method: "HEAD",
      fetchFn: mockFetchImage,
    });
    assert.equal(headResult.reachable, true);
    assert.equal(headResult.status, 200);
    assert.equal(headResult.contentType, "image/jpeg");
    assert.equal(headResult.contentLength, 102400);

    const getResult = await verifyImageReachability(`${APPROVED_RESOLVER_BASE}valid.jpg`, {
      method: "GET",
      fetchFn: mockFetchImage,
    });
    assert.equal(getResult.reachable, true);
    assert.equal(getResult.status, 200);
  });
});

