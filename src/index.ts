if (process.argv[2] === "build") {
  process.argv.pop()
  require("@effect/remix-plugin/build")
} else {
  process.argv.pop()
  require("@effect/remix-plugin/dev")
}
