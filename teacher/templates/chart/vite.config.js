/**
 * Teacher DSH artifact build configuration.
 *
 * `cacheDir` is deliberately project-local: inside a Teacher DSH installation
 * `node_modules` is a junction into the read-only bundled runtime, so Vite must never
 * write its cache there.
 *
 * `base: './'` keeps the build output portable, which is what lets a finished artifact
 * be opened from a local file server, a shared folder, or any static host.
 */
export default {
  base: './',
  cacheDir: '.teacher-cache',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    target: 'es2022',
    sourcemap: false
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: false
  }
};
