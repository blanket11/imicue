/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  trailingSlash: true,
  reactStrictMode: true,
  devIndicators: false,
  turbopack: { root: new URL('../..', import.meta.url).pathname },
};
