import { describe, expect, it } from "vitest";
import { isPushEndpoint } from "../src/worker/push";

describe("isPushEndpoint", () => {
  it("accepts the browsers' push services", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc:APA91b")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/gAAAA")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/QGuQyavXutnMH")).toBe(true);
    expect(isPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isPushEndpoint("https://127.0.0.1/x")).toBe(false);
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isPushEndpoint("https://evilpush.apple.com.example/x")).toBe(false);
    expect(isPushEndpoint("https://evil.example/?h=fcm.googleapis.com")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com/" + "a".repeat(1100))).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
  });
});
