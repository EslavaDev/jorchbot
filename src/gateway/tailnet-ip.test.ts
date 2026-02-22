import { describe, expect, it } from "vitest";
import { isTailnetIp } from "./tailnet-ip.js";

describe("isTailnetIp", () => {
  it("accepts tailnet IP 100.64.0.1", () => {
    expect(isTailnetIp("100.64.0.1")).toBe(true);
  });

  it("accepts tailnet IP 100.127.255.255 (upper bound of /10)", () => {
    expect(isTailnetIp("100.127.255.255")).toBe(true);
  });

  it("rejects IP outside tailnet range (100.128.0.1)", () => {
    expect(isTailnetIp("100.128.0.1")).toBe(false);
  });

  it("rejects public IP", () => {
    expect(isTailnetIp("8.8.8.8")).toBe(false);
  });

  it("accepts IPv4-mapped IPv6 tailnet address", () => {
    expect(isTailnetIp("::ffff:100.100.50.25")).toBe(true);
  });

  it("rejects IPv4-mapped IPv6 non-tailnet address", () => {
    expect(isTailnetIp("::ffff:192.168.1.1")).toBe(false);
  });

  it("accepts loopback 127.0.0.1", () => {
    expect(isTailnetIp("127.0.0.1")).toBe(true);
  });

  it("accepts IPv6 loopback ::1", () => {
    expect(isTailnetIp("::1")).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isTailnetIp("not-an-ip")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isTailnetIp("")).toBe(false);
  });
});
