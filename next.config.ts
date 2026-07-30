import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Belt and braces for sharp's native binary, which broke every payment-proof
  // upload with "Could not load the sharp module using the linux-x64 runtime".
  //
  // Two things had to be true and neither was:
  //   1. The binary must be INSTALLED. npm had recorded @img/sharp-linux-x64 as
  //      a skipped optional dependency, so every cache-restored install
  //      reported "up to date" and never fetched it — hence
  //      `npm ci --include=optional` in vercel.json.
  //   2. It must be TRACED into the function. The Turbopack build traced none
  //      of it; the webpack build picks up sharp and its platform package
  //      automatically (route.js.nft.json lists 74 sharp files plus the
  //      platform @img package), so `build` no longer passes --turbopack.
  //
  // These globs pin the linux binaries explicitly on top of that. Only the
  // linux variants: globbing all of @img would drag darwin/win32/wasm libvips
  // (tens of MB each) in. Paths absent on the build machine are ignored.
  outputFileTracingIncludes: {
    '/api/reservas/[code]/comprobante': [
      './node_modules/sharp/**/*',
      './node_modules/@img/sharp-linux-x64/**/*',
      './node_modules/@img/sharp-libvips-linux-x64/**/*',
      './node_modules/@img/sharp-linuxmusl-x64/**/*',
      './node_modules/@img/sharp-libvips-linuxmusl-x64/**/*',
    ],
  },

  // The project was published as "Estrellas del Sur" before the plano and the
  // maqueta confirmed it is Prados del Sur. Anything already shared on the old
  // URL — WhatsApp messages, the printed sign — has to keep working.
  async redirects() {
    return [
      {
        source: '/estrellas-del-sur/:path*',
        destination: '/prados-del-sur/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
