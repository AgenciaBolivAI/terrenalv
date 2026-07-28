import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp is a NATIVE module: the JS is tiny and the actual codec lives in a
  // per-platform package (@img/sharp-linux-x64 + its libvips). Next traces the
  // JS, treats sharp as "external", and shipped the function WITHOUT those
  // binaries — so on Vercel the import threw
  //   "Could not load the sharp module using the linux-x64 runtime"
  // and every payment-proof upload 500'd before the route's own code ran.
  //
  // The lockfile already resolves the linux binaries correctly; they just have
  // to be forced into the function's file trace. Only the linux variants are
  // listed: globbing all of @img would drag darwin/win32/wasm libvips (tens of
  // MB each) into the bundle. Paths that don't exist on the builder are ignored.
  outputFileTracingIncludes: {
    '/api/reservas/[code]/comprobante': [
      './node_modules/sharp/**/*',
      './node_modules/@img/sharp-linux-x64/**/*',
      './node_modules/@img/sharp-libvips-linux-x64/**/*',
      './node_modules/@img/sharp-linuxmusl-x64/**/*',
      './node_modules/@img/sharp-libvips-linuxmusl-x64/**/*',
    ],
  },
};

export default nextConfig;
