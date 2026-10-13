import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('./client',import.meta.url)),
  publicDir:false,
  plugins:[react()],
  build:{outDir:fileURLToPath(new URL('../web',import.meta.url)),emptyOutDir:true,target:'es2022'},
});
