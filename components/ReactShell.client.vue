<template>
  <div ref="mountEl" class="min-h-screen" />
</template>

<script setup lang="ts">
import { StrictMode, createElement } from 'react'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createRoot, type Root } from 'react-dom/client'
import App from '../src/App'
import { installMobileViewportGuards } from '../src/lib/viewport'

const mountEl = ref<HTMLElement | null>(null)
let root: Root | null = null

onMounted(() => {
  installMobileViewportGuards()
  if (!mountEl.value) return
  root = createRoot(mountEl.value)
  root.render(createElement(StrictMode, null, createElement(App)))
})

onBeforeUnmount(() => {
  root?.unmount()
  root = null
})
</script>
