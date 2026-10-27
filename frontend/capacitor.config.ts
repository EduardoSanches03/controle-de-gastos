import type { CapacitorConfig } from '@capacitor/cli'

// App Android: a mesma interface, com o banco guardado no aparelho (ver src/local)
const config: CapacitorConfig = {
  appId: 'br.pessoal.controledegastos',
  appName: 'Controle de Gastos',
  webDir: 'dist',
  backgroundColor: '#0f1012',
}

export default config
