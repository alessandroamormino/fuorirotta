'use client'

import { HeimdallProvider } from 'heimdall-sdk'

const COLLECTOR_URL = process.env.NEXT_PUBLIC_HEIMDALL_URL ?? 'http://localhost:3333'

export default function HeimdallWrapper({ children }: { children: React.ReactNode }) {
  return (
    <HeimdallProvider
      collectorUrl={COLLECTOR_URL}
      project="fuorirotta"
      enabled={!!process.env.NEXT_PUBLIC_HEIMDALL_URL}
    >
      {children}
    </HeimdallProvider>
  )
}
