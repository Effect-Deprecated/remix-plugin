// eslint-disable-next-line @typescript-eslint/no-var-requires
require("@remix-run/dev/dist/compiler/compileBrowser").createBrowserCompiler =
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("@effect/remix-plugin/compiler/browser").createBrowserCompiler
// eslint-disable-next-line @typescript-eslint/no-var-requires
require("@remix-run/dev/dist/compiler/compilerServer").createServerCompiler =
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("@effect/remix-plugin/compiler/server").createServerCompiler

// eslint-disable-next-line @typescript-eslint/no-var-requires
const index = require("@remix-run/dev/dist/index.js")
// eslint-disable-next-line @typescript-eslint/no-var-requires
const child = require("child_process")

const cli = index.cli
const argv = process.argv

process.env["NODE_ENV"] = "development"
process.argv = [...argv, "build"]

cli.run().then(
  () => {
    const forked = child.exec(
      "cross-env NODE_ENV=development nodemon --require dotenv/config ./server.js --watch ./server.js",
      (exit: any) => {
        if (exit.code !== 0) {
          process.exit(exit.code)
        }
      }
    )

    forked.stdout.pipe(process.stdout)
    forked.stderr.pipe(process.stderr)

    process.argv = [...argv, "watch"]

    cli.run().then(
      () => {
        forked.kill(0)
        process.exit(0)
      },
      (error: any) => {
        forked.kill(1)
        // for expected errors we only show the message (if any), no stack trace
        if (error instanceof index.CliError) error = error.message
        if (error) console.error(error)
        process.exit(1)
      }
    )
  },
  (error: any) => {
    // for expected errors we only show the message (if any), no stack trace
    if (error instanceof index.CliError) error = error.message
    if (error) console.error(error)
    process.exit(1)
  }
)

export {}
