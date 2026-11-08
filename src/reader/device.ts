// A random id per browser (to tell this device's saved positions from others') and a readable
// name for the "you were on page X on <device>" prompt.

const KEY = "ribbon:device";

export const deviceId: string = (() => {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

export const deviceName: string = (() => {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua)
    ? /Mobile/.test(ua) ? "Android phone" : "Android tablet"
    : /iPhone/.test(ua) ? "iPhone"
    : /iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad"
    : /CrOS/.test(ua) ? "Chromebook"
    : /Macintosh/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows PC"
    : /Kindle|Silk/.test(ua) ? "Kindle"
    : /Linux/.test(ua) ? "Linux PC"
    : "another device";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "";
  return browser ? `${os} (${browser})` : os;
})();
