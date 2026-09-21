import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  transpilePackages: ["@igle/core", "@igle/shared", "@igle/html-engine"],
  // ssh2 (CloudPanel deploys) ships a native .node binding — webpack can't bundle that, so it
  // needs to stay a normal runtime require() instead of being pulled into the build graph.
  // serverExternalPackages alone doesn't reliably catch this when the require path runs through
  // an already-transpiled workspace package (@igle/core -> @igle/deployer -> ssh2), so this also
  // externalizes it directly at the webpack config level, which does.
  serverExternalPackages: ["ssh2", "cpu-features"],
  webpack(config, { isServer }) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"]
    };
    if (isServer) {
      const externals = Array.isArray(config.externals) ? config.externals : config.externals ? [config.externals] : [];
      externals.push(({ request }, callback) => {
        if (request === "ssh2" || request === "cpu-features" || request.endsWith(".node")) {
          return callback(null, `commonjs ${request}`);
        }
        callback();
      });
      config.externals = externals;
    }
    return config;
  }
};

export default nextConfig;
