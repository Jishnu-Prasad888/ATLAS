import React from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import './src/nativewind-env'
import RootApp from './src/navigation/AppNavigator'
import { ThemeProvider } from './src/theme'

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RootApp />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
