// @ts-check
import { defineConfig } from 'astro/config';

import { searchIndexIntegration } from './src/lib/search-integration.mjs';

const site = (process.env.SITE_URL || 'https://onjaryo.vercel.app').replace(/\/$/, '');

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  integrations: [searchIndexIntegration()],
  devToolbar: { enabled: false },
});
