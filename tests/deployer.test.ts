import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalReleaseDeploymentProvider, NginxProvider } from "@igle/deployer";

describe("deployment providers", () => {
  it("generates Nginx config with validated redirects", () => {
    const config = new NginxProvider().generateConfig({
      domain: "example.com",
      alternateDomains: ["www.example.com"],
      root: "/var/www/example.com/current",
      https: true,
      urlStyle: "clean",
      redirects: [{ from: "/old", to: "/new", status: 301 }]
    });
    expect(config).toContain("server_name example.com www.example.com");
    expect(config).toContain("return 301 /new");
    expect(() =>
      new NginxProvider().generateConfig({
        domain: "example.com;",
        alternateDomains: [],
        root: "/var/www/example.com/current",
        https: true,
        urlStyle: "clean"
      })
    ).toThrow();
  });

  it("deploys releases and rolls back when smoke checks fail", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "igle-deploy-test-"));
    const goodBuild = path.join(root, "good-build");
    const badBuild = path.join(root, "bad-build");
    const remote = path.join(root, "remote");
    await fs.mkdir(goodBuild);
    await fs.writeFile(path.join(goodBuild, "index.html"), "ok", "utf8");
    await fs.writeFile(path.join(goodBuild, "robots.txt"), "ok", "utf8");
    await fs.writeFile(path.join(goodBuild, "sitemap.xml"), "ok", "utf8");
    await fs.mkdir(badBuild);
    await fs.writeFile(path.join(badBuild, "index.html"), "bad", "utf8");

    const provider = new LocalReleaseDeploymentProvider();
    const first = await provider.deploy({ buildPath: goodBuild, remoteDirectory: remote, revisionId: "rev_1" });
    expect(await fs.readlink(path.join(remote, "current"))).toBe(first.releasePath);

    await expect(provider.deploy({ buildPath: badBuild, remoteDirectory: remote, revisionId: "rev_2" })).rejects.toThrow(/rolled back/);
    expect(await fs.readlink(path.join(remote, "current"))).toBe(first.releasePath);
  });
});
