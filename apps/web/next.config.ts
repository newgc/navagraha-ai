import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Temple data workbooks are uploaded through a server action; the API accepts up to 5 MB.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
};

export default config;
