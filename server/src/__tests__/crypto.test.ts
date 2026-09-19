import { describe, expect, it } from "vitest";
import { decrypt, encrypt, isMasked, mask } from "../crypto";

describe("crypto", () => {
  it("round-trips a secret through encrypt/decrypt", () => {
    const secret = "super-secret-token-value-12345";
    const enc = encrypt(secret);
    expect(enc).not.toBe(secret);
    expect(enc.startsWith("enc:")).toBe(true);
    expect(decrypt(enc)).toBe(secret);
  });

  it("returns empty string for empty/undefined input", () => {
    expect(encrypt("")).toBe("");
    expect(encrypt(undefined)).toBe("");
    expect(encrypt(null)).toBe("");
    expect(decrypt("")).toBe("");
    expect(decrypt(undefined)).toBe("");
  });

  it("fails closed (returns empty string) on tampered ciphertext", () => {
    const enc = encrypt("hello-world");
    const tampered = enc.slice(0, -4) + "abcd";
    expect(decrypt(tampered)).toBe("");
  });

  it("masks a secret to bullets + last 4 characters", () => {
    expect(mask("abcd1234wxyz")).toBe("••••wxyz");
    expect(mask("")).toBe("");
    expect(mask(null)).toBe("");
    expect(mask(undefined)).toBe("");
  });

  it("recognizes masked placeholders", () => {
    expect(isMasked(mask("abcdef1234"))).toBe(true);
    expect(isMasked("plain-value")).toBe(false);
    expect(isMasked("")).toBe(false);
  });
});
