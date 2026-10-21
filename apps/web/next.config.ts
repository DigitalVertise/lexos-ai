import type { NextConfig } from "next";

const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone: voice mode here; mic/camera also delegated to the embedded live assistant.
  { key: "Permissions-Policy", value: 'camera=(self "https://dv-livechat.base44.app"), microphone=(self "https://dv-livechat.base44.app"), geolocation=()' },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];
const noFraming = [{ key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }];
// Only the small portal launcher may be embedded on a firm's own website.
const embeddable = [{ key: "Content-Security-Policy", value: "frame-ancestors https:" }];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // unpdf/mammoth are server-only and should not be bundled.
  serverExternalPackages: ["unpdf", "mammoth"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/((?!portal/[^/]+/embed).*)", headers: [...baseHeaders, ...noFraming] },
      { source: "/portal/:slug/embed", headers: [...baseHeaders, ...embeddable] },
    ];
  },
};

export default nextConfig;
