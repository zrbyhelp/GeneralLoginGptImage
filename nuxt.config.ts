import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string }

export default defineNuxtConfig({
  compatibilityDate: '2026-05-03',
  ssr: false,
  css: ['~/src/index.css'],
  runtimeConfig: {
    portalBaseUrl: 'https://zrg.zrbyhelp.com',
    feedbackServiceSlug: 'gpt-image-playground',
    serviceClientId: '',
    serviceClientSecret: '',
    adminAccounts: '',
    adminEmails: '',
    storageDir: 'storage/generated-images',
    appDataDir: 'storage/app-data',
    dbPath: 'storage/app-data/app.db',
    defaultHourlyImageLimit: '20',
    defaultPrivacyHourlyImageLimit: '5',
    defaultServiceConcurrentImageLimit: '3',
    defaultUserConcurrentImageLimit: '3',
    defaultDailyPointsTarget: '100',
    defaultStandardPointCost: '1',
    defaultGalleryUploadDefault: 'false',
    galleryUploadUrl: 'https://imglist.zrbyhelp.com/api/uploads/third-party',
    galleryUploadToken: '',
    backupS3Endpoint: '',
    backupS3Region: 'auto',
    backupS3Bucket: '',
    backupS3AccessKeyId: '',
    backupS3SecretAccessKey: '',
    backupS3Prefix: 'backups',
    backupS3ForcePathStyle: 'false',
    backupScheduleEnabled: 'false',
    backupScheduleCron: '0 2 * * *',
    backupScheduleTimezone: 'Asia/Shanghai',
    backupScheduleRetainDays: '14',
    backupScheduleRetainCount: '10',
    apiProvider: 'openai',
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    apiModel: 'gpt-image-2',
    apiMode: 'images',
    apiTimeout: '600',
    apiCodexCli: 'false',
    public: {
      appUrl: 'http://localhost:3000',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: 'GPT Image Playground',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover' },
        { name: 'theme-color', content: '#f8fafc' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'GPT Image' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      ],
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'apple-touch-icon', href: '/pwa-icon.svg' },
        { rel: 'icon', href: '/pwa-icon.svg', type: 'image/svg+xml' },
      ],
    },
  },
  postcss: {
    plugins: {
      tailwindcss: {},
      autoprefixer: {},
    },
  },
  vite: {
    vueJsx: {
      include: [/\.vue-jsx\.[jt]sx$/],
      tsTransform: 'built-in',
    },
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
      __DEV_PROXY_CONFIG__: 'null',
    },
  },
})
