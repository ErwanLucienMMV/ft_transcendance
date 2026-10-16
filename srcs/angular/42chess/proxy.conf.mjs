const target = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';
export default {
  '/api': { target, changeOrigin: true, pathRewrite: { '^/api': '' } },
  '/ws': { target, ws: true },
};
