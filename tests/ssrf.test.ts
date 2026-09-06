import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  checkUrlShape,
  isPrivateAddress,
} from "../src/lib/security/safe-fetch.ts";

/**
 * SSRF protection for customer-supplied URLs.
 *
 * The website analyser takes a URL from a form and fetches it from inside our
 * own network. Without these checks that is a request-forgery primitive: a
 * customer could point it at the cloud metadata endpoint and read instance
 * credentials, or at an internal service that trusts network position.
 *
 * These tests are deliberately adversarial rather than illustrative. Each one
 * is a real bypass someone would try, and a regression in any of them is a
 * credential-disclosure bug, not a cosmetic one.
 */

describe("private address detection", () => {
  test("the cloud metadata endpoint is blocked", () => {
    // The single most valuable SSRF target on AWS, GCP and Azure alike.
    assert.equal(isPrivateAddress("169.254.169.254"), true);
    assert.equal(isPrivateAddress("169.254.170.2"), true);
  });

  test("RFC1918 ranges are blocked", () => {
    for (const address of [
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.168.255.255",
    ]) {
      assert.equal(isPrivateAddress(address), true, `${address} should be private`);
    }
  });

  test("the edges of 172.16/12 are judged correctly", () => {
    // 172.15 and 172.32 are public; only 172.16–172.31 are reserved. An
    // over-broad check here would block legitimate customer websites.
    assert.equal(isPrivateAddress("172.15.255.255"), false);
    assert.equal(isPrivateAddress("172.16.0.0"), true);
    assert.equal(isPrivateAddress("172.31.255.255"), true);
    assert.equal(isPrivateAddress("172.32.0.0"), false);
  });

  test("loopback, this-network, CGNAT and multicast are blocked", () => {
    for (const address of [
      "127.0.0.1",
      "127.255.255.254",
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      assert.equal(isPrivateAddress(address), true, `${address} should be private`);
    }
  });

  test("ordinary public addresses are allowed", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.217.169.4"]) {
      assert.equal(isPrivateAddress(address), false, `${address} should be public`);
    }
  });

  test("IPv6 loopback, link-local and unique-local are blocked", () => {
    for (const address of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1"]) {
      assert.equal(isPrivateAddress(address), true, `${address} should be private`);
    }
  });

  test("an IPv4-mapped IPv6 address is judged as the IPv4 address it is", () => {
    // ::ffff:169.254.169.254 reaches the metadata endpoint just as well as the
    // bare form. Treating it as "some IPv6 address" would be the bypass.
    assert.equal(isPrivateAddress("::ffff:169.254.169.254"), true);
    assert.equal(isPrivateAddress("::ffff:10.0.0.1"), true);
    assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
  });

  test("anything that is not an IP literal is refused, not assumed public", () => {
    // The caller resolves hostnames; this function must never be the thing
    // that lets an unresolved name through.
    for (const value of ["example.com", "", "not-an-ip", "999.999.999.999"]) {
      assert.equal(isPrivateAddress(value), true, `${value} should not be trusted`);
    }
  });
});

describe("URL shape checks", () => {
  test("ordinary https URLs pass", () => {
    const result = checkUrlShape("https://www.blackwellenroofing.co.uk/about");
    assert.equal(result.ok, true);
  });

  test("non-http schemes are refused", () => {
    for (const url of [
      "file:///etc/passwd",
      "gopher://example.com/",
      "ftp://example.com/",
      "data:text/html,hello",
      "javascript:alert(1)",
    ]) {
      const result = checkUrlShape(url);
      assert.equal(result.ok, false, `${url} should be refused`);
    }
  });

  test("private literals are refused before any DNS lookup", () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:3000/",
      "http://10.0.0.5/",
      "http://[::1]/",
    ]) {
      const result = checkUrlShape(url);
      assert.equal(result.ok, false, `${url} should be refused`);
      if (!result.ok) assert.equal(result.code, "BLOCKED_HOST");
    }
  });

  test("localhost and internal hostnames are refused by name", () => {
    for (const url of [
      "http://localhost/",
      "http://localhost:8080/",
      "http://metadata.google.internal/",
      "http://something.internal/",
    ]) {
      const result = checkUrlShape(url);
      assert.equal(result.ok, false, `${url} should be refused`);
    }
  });

  test("non-web ports are refused", () => {
    // A public host on port 6379 is a Redis instance, not a website.
    for (const url of [
      "http://example.com:22/",
      "http://example.com:6379/",
      "http://example.com:5432/",
      "http://example.com:11211/",
    ]) {
      const result = checkUrlShape(url);
      assert.equal(result.ok, false, `${url} should be refused`);
      if (!result.ok) assert.equal(result.code, "BLOCKED_PORT");
    }
  });

  test("the standard web ports are allowed", () => {
    assert.equal(checkUrlShape("http://example.com:80/").ok, true);
    assert.equal(checkUrlShape("https://example.com:443/").ok, true);
  });

  test("a malformed URL is refused rather than throwing", () => {
    for (const url of ["", "   ", "not a url", "http://", "://example.com"]) {
      const result = checkUrlShape(url);
      assert.equal(result.ok, false, `${url} should be refused`);
    }
  });

  test("credentials in the URL do not smuggle a different host past the check", () => {
    // `http://example.com@169.254.169.254/` has host 169.254.169.254 — the
    // part before the @ is userinfo. Parsing it as the host would be the bug.
    const result = checkUrlShape("http://example.com@169.254.169.254/");
    assert.equal(result.ok, false);
  });
});
