/** Tailwind is scoped with a prefix so plugin utilities never leak into DSH. */
module.exports = {
  prefix: 'dshnudge-',
  content: ['./src/client/ui/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
}
