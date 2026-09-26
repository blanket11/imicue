/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  turbopack: { root: new URL('../..', import.meta.url).pathname },
};
