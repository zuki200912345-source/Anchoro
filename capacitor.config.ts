import type { CapacitorConfig } from "@capacitor/cli";

// iOS wrapper config — see APP-STORE.md for the full submission plan.
//
// Production ships the static export bundled in the app (webDir: "out");
// pointing server.url at the hosted site in a store build is the classic
// guideline 4.2 "repackaged website" rejection. During development you may
// temporarily add:
//   server: { url: "http://localhost:5730", cleartext: true }
// to live-reload against the dev server — never commit that enabled.
const config: CapacitorConfig = {
  appId: "app.anchor.study",
  appName: "Anchor",
  webDir: "out",
  ios: {
    contentInset: "never",
  },
};

export default config;
