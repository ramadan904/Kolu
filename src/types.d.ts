// Next generates `next-env.d.ts` at build time and it is gitignored, so this
// keeps `tsc --noEmit` working on a clean clone before the first build.
declare module "*.css";
