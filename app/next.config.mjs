/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["molstar", "@dynamic-pdb/hetkit"],
};

export default nextConfig;
