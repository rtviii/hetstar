/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["molstar", "@dynamic-pdb/hetkit", "@dynamic-pdb/hetstar"],
};

export default nextConfig;
