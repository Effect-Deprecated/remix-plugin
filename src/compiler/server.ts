import { NodeModulesPolyfillPlugin } from "@esbuild-plugins/node-modules-polyfill"
import * as esbuild from "esbuild"
import * as fse from "fs-extra"
import * as path from "path"

import { effectPlugin } from "@effect/remix-plugin/plugins/effect"
import { type ReadChannel } from "@remix-run/dev/dist/channel"
import { type AssetsManifest } from "@remix-run/dev/dist/compiler/assets"
import { loaders } from "@remix-run/dev/dist/compiler/loaders"
import { type CompileOptions } from "@remix-run/dev/dist/compiler/options"
import { cssFilePlugin } from "@remix-run/dev/dist/compiler/plugins/cssFilePlugin"
import { deprecatedRemixPackagePlugin } from "@remix-run/dev/dist/compiler/plugins/deprecatedRemixPackagePlugin"
import { emptyModulesPlugin } from "@remix-run/dev/dist/compiler/plugins/emptyModulesPlugin"
import { mdxPlugin } from "@remix-run/dev/dist/compiler/plugins/mdx"
import { serverAssetsManifestPlugin } from "@remix-run/dev/dist/compiler/plugins/serverAssetsManifestPlugin"
import { serverBareModulesPlugin } from "@remix-run/dev/dist/compiler/plugins/serverBareModulesPlugin"
import { serverEntryModulePlugin } from "@remix-run/dev/dist/compiler/plugins/serverEntryModulePlugin"
import { serverRouteModulesPlugin } from "@remix-run/dev/dist/compiler/plugins/serverRouteModulesPlugin"
import { urlImportsPlugin } from "@remix-run/dev/dist/compiler/plugins/urlImportsPlugin"
import { type RemixConfig } from "@remix-run/dev/dist/config"

export type ServerCompiler = {
  // produce ./build/index.js
  compile: (manifestChannel: ReadChannel<AssetsManifest>) => Promise<void>
  dispose: () => void
}

const createEsbuildConfig = (
  config: RemixConfig,
  assetsManifestChannel: ReadChannel<AssetsManifest>,
  options: CompileOptions
): esbuild.BuildOptions => {
  let stdin: esbuild.StdinOptions | undefined
  let entryPoints: Array<string> | undefined

  if (config.serverEntryPoint) {
    entryPoints = [config.serverEntryPoint]
  } else {
    stdin = {
      contents: config.serverBuildTargetEntryModule,
      resolveDir: config.rootDirectory,
      loader: "ts"
    }
  }

  const isCloudflareRuntime = ["cloudflare-pages", "cloudflare-workers"].includes(
    config.serverBuildTarget ?? ""
  )
  const isDenoRuntime = config.serverBuildTarget === "deno"

  const plugins: Array<esbuild.Plugin> = [
    deprecatedRemixPackagePlugin(options.onWarning),
    cssFilePlugin(options),
    urlImportsPlugin(),
    mdxPlugin(config),
    emptyModulesPlugin(config, /\.client(\.[jt]sx?)?$/),
    serverRouteModulesPlugin(config),
    serverEntryModulePlugin(config),
    serverAssetsManifestPlugin(assetsManifestChannel.read()),
    serverBareModulesPlugin(config, options.onWarning)
  ]

  if (config.serverPlatform !== "node") {
    plugins.unshift(NodeModulesPolyfillPlugin())
  }

  plugins.unshift(effectPlugin())

  return {
    absWorkingDir: config.rootDirectory,
    stdin,
    entryPoints,
    outfile: config.serverBuildPath,
    conditions: isCloudflareRuntime ? ["worker"] : isDenoRuntime ? ["deno", "worker"] : undefined,
    platform: config.serverPlatform,
    format: config.serverModuleFormat,
    treeShaking: true,
    // The type of dead code elimination we want to do depends on the
    // minify syntax property: https://github.com/evanw/esbuild/issues/672#issuecomment-1029682369
    // Dev builds are leaving code that should be optimized away in the
    // bundle causing server / testing code to be shipped to the browser.
    // These are properly optimized away in prod builds today, and this
    // PR makes dev mode behave closer to production in terms of dead
    // code elimination / tree shaking is concerned.
    minifySyntax: true,
    minify: options.mode === "production" && isCloudflareRuntime,
    mainFields: isCloudflareRuntime
      ? ["browser", "module", "main"]
      : config.serverModuleFormat === "esm"
      ? ["module", "main"]
      : ["main", "module"],
    target: options.target,
    loader: loaders,
    bundle: true,
    logLevel: "silent",
    // As pointed out by https://github.com/evanw/esbuild/issues/2440, when tsconfig is set to
    // `undefined`, esbuild will keep looking for a tsconfig.json recursively up. This unwanted
    // behavior can only be avoided by creating an empty tsconfig file in the root directory.
    tsconfig: config.tsconfigPath,
    sourcemap: options.sourcemap, // use linked (true) to fix up .map file
    // The server build needs to know how to generate asset URLs for imports
    // of CSS and other files.
    assetNames: "_assets/[name]-[hash]",
    publicPath: config.publicPath,
    define: {
      "process.env.NODE_ENV": JSON.stringify(options.mode),
      "process.env.REMIX_DEV_SERVER_WS_PORT": JSON.stringify(config.devServerPort)
    },
    jsx: "automatic",
    jsxDev: options.mode !== "production",
    plugins
  }
}

async function writeServerBuildResult(config: RemixConfig, outputFiles: Array<esbuild.OutputFile>) {
  await fse.ensureDir(path.dirname(config.serverBuildPath))

  for (const file of outputFiles) {
    if (file.path.endsWith(".js")) {
      // fix sourceMappingURL to be relative to current path instead of /build
      const filename = file.path.substring(file.path.lastIndexOf(path.sep) + 1)
      const escapedFilename = filename.replace(/\./g, "\\.")
      const pattern = `(//# sourceMappingURL=)(.*)${escapedFilename}`
      let contents = Buffer.from(file.contents).toString("utf-8")
      contents = contents.replace(new RegExp(pattern), `$1${filename}`)
      await fse.writeFile(file.path, contents)
    } else if (file.path.endsWith(".map")) {
      // remove route: prefix from source filenames so breakpoints work
      let contents = Buffer.from(file.contents).toString("utf-8")
      contents = contents.replace(/"route:/gm, "\"")
      await fse.writeFile(file.path, contents)
    } else {
      const assetPath = path.join(
        config.assetsBuildDirectory,
        file.path.replace(path.dirname(config.serverBuildPath), "")
      )
      await fse.ensureDir(path.dirname(assetPath))
      await fse.writeFile(assetPath, file.contents)
    }
  }
}

export const createServerCompiler = (
  remixConfig: RemixConfig,
  options: CompileOptions
): ServerCompiler => {
  const compile = async (manifestChannel: ReadChannel<AssetsManifest>) => {
    const esbuildConfig = createEsbuildConfig(remixConfig, manifestChannel, options)
    const { outputFiles } = await esbuild.build({
      ...esbuildConfig,
      write: false
    })
    await writeServerBuildResult(remixConfig, outputFiles!)
  }
  return {
    compile,
    dispose: () => undefined
  }
}
