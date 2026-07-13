import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@mlv/ui', '@mlv/types', '@mlv/auth'],
};

export default nextConfig;
